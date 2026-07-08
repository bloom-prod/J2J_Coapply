/**
 * Create userProfiles docs for any ownerUid that doesn't have one.
 * Looks up Firebase Auth display name as the canonical name.
 */
import { readFileSync } from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const env = {};
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}
const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({
  projectId: env.FIREBASE_PROJECT_ID,
  clientEmail: env.FIREBASE_CLIENT_EMAIL,
  privateKey: (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
}) });
const db = getFirestore(app);
const auth = getAuth(app);
db.settings({ preferRest: true, ignoreUndefinedProperties: true });

const appsSnap = await db.collection("applications").get();
const profilesSnap = await db.collection("userProfiles").get();
const hasProfile = new Set(profilesSnap.docs.map((d) => d.id));

// Collect all unique ownerUids that are missing a userProfiles doc
const missingUids = new Set();
appsSnap.docs.forEach((d) => {
  const uid = d.data().ownerUid || "";
  if (uid && !hasProfile.has(uid)) missingUids.add(uid);
});

if (missingUids.size === 0) {
  console.log("All ownerUids already have a userProfiles doc.");
  process.exit(0);
}

console.log(`Found ${missingUids.size} uid(s) without a profile:`, [...missingUids]);

for (const uid of missingUids) {
  let name = "";
  try {
    const u = await auth.getUser(uid);
    name = u.displayName || u.email?.split("@")[0] || "";
  } catch {
    // uid doesn't exist in auth (deleted account etc.)
  }
  if (!name) name = "User " + uid.slice(0, 6);
  await db.collection("userProfiles").doc(uid).set(
    { name, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  console.log(`  ${uid.slice(0, 14)}… → "${name}"`);
}

console.log("Done.");
