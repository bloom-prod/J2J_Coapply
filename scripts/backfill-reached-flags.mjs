/**
 * One-time backfill: populate the sticky `reached*` funnel flags on existing
 * application docs so the accurate-tracking funnel/rates include apps created
 * before the flags existed.
 *
 * We have no status history for legacy docs, so flags are derived from the
 * CURRENT status (mirroring lib/types.ts `computeReachedFlags`):
 *   - a doc at a funnel stage gets the flag for that stage (e.g. "Interview" →
 *     reachedInterview), and reachedApplied is inferred whenever any later
 *     flag is set (you can't interview without applying);
 *   - "Offer" ⇒ reachedInterview + reachedOffer;
 *   - existing flags (e.g. a pre-existing reachedInterview on a now-Rejected
 *     doc) are preserved and, via the prerequisite rule, also fill reachedApplied.
 *
 * This never over-counts skipped stages: an app currently at "Interview" that
 * never passed through "OA" gets reachedApplied + reachedInterview only — not
 * reachedOA. Run the write-path going forward for apps that move through OA.
 *
 * Run:  node scripts/backfill-reached-flags.mjs          (dry run)
 *       node scripts/backfill-reached-flags.mjs --apply  (actually write)
 */
import { readFileSync } from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const STAGE_FLAGS = [
  "reachedApplied",
  "reachedOA",
  "reachedPhoneScreen",
  "reachedInterview",
  "reachedOffer",
];

function reachedFlagsForStatus(status) {
  switch (status) {
    case "Applied": return { reachedApplied: true };
    case "OA": return { reachedOA: true };
    case "Phone Screen": return { reachedPhoneScreen: true };
    case "Interview": return { reachedInterview: true };
    case "Offer": return { reachedInterview: true, reachedOffer: true };
    default: return {};
  }
}

function computeReachedFlags(status, existing = {}) {
  const merged = { ...existing, ...reachedFlagsForStatus(status) };
  if (
    merged.reachedOA || merged.reachedPhoneScreen ||
    merged.reachedInterview || merged.reachedOffer
  ) {
    merged.reachedApplied = true;
  }
  return merged;
}

// .env.local has CRLF endings; a trailing \r breaks the `$` anchor below.
const env = {};
for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}
const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({
  projectId: env.FIREBASE_PROJECT_ID,
  clientEmail: env.FIREBASE_CLIENT_EMAIL,
  privateKey: (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
}) });
const db = getFirestore(app);
db.settings({ preferRest: true, ignoreUndefinedProperties: true });

const apply = process.argv.includes("--apply");

const snap = await db.collection("applications").get();
let touched = 0;
let added = 0;
const byStage = {};

for (const doc of snap.docs) {
  const data = doc.data();
  const status = data.status || "Applied";
  byStage[status] = (byStage[status] || 0) + 1;

  const existing = {};
  for (const k of STAGE_FLAGS) if (data[k] === true) existing[k] = true;
  const desired = computeReachedFlags(status, existing);

  // Only write flags that aren't already true (never clears anything).
  const toSet = {};
  let changed = false;
  for (const k of STAGE_FLAGS) {
    if (desired[k] === true && existing[k] !== true) {
      toSet[k] = true;
      changed = true;
      added++;
    }
  }
  if (!changed) continue;

  touched++;
  if (apply) await doc.ref.update(toSet);
  const flagNames = Object.keys(toSet).join(", ");
  console.log(`  ${apply ? "UPDATE" : "would set"} ${doc.id} [${status}] +${flagNames}`);
}

console.log(`\napplications: ${snap.size} | docs needing flags: ${touched} | flags added: ${added}`);
console.log("status distribution:", JSON.stringify(byStage));
if (!apply) {
  console.log("\nDry run — re-run with --apply to write these flags.");
} else {
  console.log("Done. Existing apps now carry reached* flags for the funnel/rates.");
}
