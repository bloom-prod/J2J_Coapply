import { readFileSync } from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
db.settings({ preferRest: true });

const appsSnap = await db.collection("applications").get();
const uidToNames = new Map();
const uidCount = new Map();
appsSnap.docs.forEach((d) => {
  const uid = d.data().ownerUid || "(none)";
  const name = d.data().ownerName || "(none)";
  if (!uidToNames.has(uid)) { uidToNames.set(uid, new Set()); uidCount.set(uid, 0); }
  uidToNames.get(uid).add(name);
  uidCount.set(uid, uidCount.get(uid) + 1);
});

const profilesSnap = await db.collection("userProfiles").get();
const profileUids = new Map();
profilesSnap.docs.forEach((d) => profileUids.set(d.id, d.data().name || "(no name)"));

console.log("uid → names in apps  [count]  [userProfile name]");
for (const [uid, names] of uidToNames) {
  const count = uidCount.get(uid);
  const profileName = profileUids.get(uid) || "NO PROFILE";
  console.log(`  ${uid.slice(0, 14)}…  →  [${[...names].join(" / ")}]  (${count} apps)  profile: "${profileName}"`);
}

console.log("\nuserProfiles with no matching apps:");
for (const [uid, name] of profileUids) {
  if (!uidToNames.has(uid)) console.log(`  ${uid.slice(0, 14)}…  name="${name}"`);
}
