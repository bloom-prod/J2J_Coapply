/**
 * One-time migration: remove ownerName / userName from all Firestore records.
 * Name is now resolved purely from userProfiles via ownerUid on the client.
 *
 * Run with: node scripts/strip-owner-names.mjs
 */

import { readFileSync } from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
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

const COLLECTIONS = [
  { name: "applications",        field: "ownerName" },
  { name: "feed",                field: "ownerName" },
  { name: "jobPosts",            field: "ownerName" },
  { name: "interviewPrepPosts",  field: "ownerName" },
  { name: "interviewPrepComments", field: "userName" },
];

for (const { name, field } of COLLECTIONS) {
  const snap = await db.collection(name).get();
  const toStrip = snap.docs.filter((d) => d.data()[field] !== undefined);
  if (toStrip.length === 0) {
    console.log(`${name}: nothing to strip`);
    continue;
  }
  let written = 0;
  for (let i = 0; i < toStrip.length; i += 500) {
    const batch = db.batch();
    toStrip.slice(i, i + 500).forEach((d) => batch.update(d.ref, { [field]: FieldValue.delete() }));
    await batch.commit();
    written += Math.min(500, toStrip.length - i);
  }
  console.log(`${name}: stripped "${field}" from ${written} docs`);
}

console.log("\nDone.");
