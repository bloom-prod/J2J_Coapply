/**
 * One-time cleanup: remove feed events that announce "applied to X" for jobs
 * the user only bookmarked as "Want to Apply".
 *
 * Adding a "Want to Apply" row used to emit a type:"applied" feed event, so the
 * activity list reported bookmarks as applications — showing far more activity
 * than the Shame Wall counted. The write path is fixed; this clears the events
 * already stored so the feed stops showing them.
 *
 * Run:  node scripts/cleanup-wishlist-feed-events.mjs          (dry run)
 *       node scripts/cleanup-wishlist-feed-events.mjs --apply  (actually delete)
 */
import { readFileSync } from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Split on /\r?\n/ — .env.local has CRLF endings, and a trailing \r makes the
// `$` anchor below fail to match, silently yielding an empty config.
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

const profiles = await db.collection("userProfiles").get();
const uidToName = new Map(profiles.docs.map((d) => [d.id, d.data().name || "Someone"]));

const snap = await db.collection("feed").get();
const bogus = snap.docs.filter((d) => {
  const x = d.data();
  return x.type === "applied" && x.status === "Want to Apply";
});

console.log(`feed total: ${snap.size} | "applied" events that are really wishlist adds: ${bogus.length}`);
if (bogus.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

for (const d of bogus) {
  const x = d.data();
  const when = x.ts?.toDate?.()?.toISOString?.() ?? "?";
  console.log(`  ${apply ? "DELETE" : "would delete"}: ${uidToName.get(x.ownerUid) || x.ownerUid} — ${x.company || "?"} (${when})`);
}

if (!apply) {
  console.log("\nDry run — re-run with --apply to delete these events.");
  process.exit(0);
}

let deleted = 0;
for (let i = 0; i < bogus.length; i += 500) {
  const batch = db.batch();
  bogus.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
  await batch.commit();
  deleted += Math.min(500, bogus.length - i);
  console.log(`Deleted ${deleted}/${bogus.length}...`);
}
console.log("Done. The activity feed will now only show real applications.");
