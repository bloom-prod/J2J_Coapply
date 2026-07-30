/**
 * One-time cleanup: delete leetcodeProblems docs with old-format IDs.
 *
 * The doc ID used to be just the problem slug (e.g. "0001-two-sum"), which
 * collided across users — whoever synced last owned the doc. IDs are now
 * "<uid>_<problemId>". Old-format docs (no "_" in the ID; Firebase UIDs never
 * contain underscores) must be removed or the stats endpoint double-counts
 * every problem after the next sync.
 *
 * Run:      node scripts/cleanup-leetcode-old-ids.mjs          (dry run)
 *           node scripts/cleanup-leetcode-old-ids.mjs --apply  (actually delete)
 * Then have each user re-sync (or POST /api/leetcode/refresh with force:true)
 * so problems are rewritten under their correct owners.
 */
import { readFileSync } from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const env = {};
// Split on /\r?\n/ — .env.local has CRLF endings, and a trailing \r makes the
// `$` anchor below fail to match, silently yielding an empty config.
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

const snap = await db.collection("leetcodeProblems").get();
const oldDocs = snap.docs.filter((d) => !d.id.includes("_"));

console.log(`leetcodeProblems total: ${snap.size} | old-format (no "_" in ID): ${oldDocs.length}`);
if (oldDocs.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

for (const d of oldDocs) {
  const x = d.data();
  console.log(`  ${apply ? "DELETE" : "would delete"}: ${d.id} (userName: ${x.userName || "?"}, solvedAt: ${x.solvedAt || "?"})`);
}

if (!apply) {
  console.log("\nDry run — re-run with --apply to delete these docs.");
  process.exit(0);
}

// Firestore batches cap at 500 ops.
let deleted = 0;
for (let i = 0; i < oldDocs.length; i += 500) {
  const batch = db.batch();
  oldDocs.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
  await batch.commit();
  deleted += Math.min(500, oldDocs.length - i);
  console.log(`Deleted ${deleted}/${oldDocs.length}...`);
}
console.log("Done. Now trigger a force refresh so each user's problems are re-synced under the new IDs.");
