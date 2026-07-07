/**
 * Migration: fix two problems at once
 *
 * 1. Backfill ownerUid on applications missing it (just in case).
 * 2. Backfill `name` on userProfiles docs that are missing it —
 *    these show up as "Someone" for everyone, causing duplicate-looking
 *    leaderboard entries and broken chart groupings.
 *
 * Run with: node scripts/fix-owner-uids.mjs
 */

import { readFileSync } from "fs";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// Load .env.local
const envFile = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}

const projectId = env.FIREBASE_PROJECT_ID;
const clientEmail = env.FIREBASE_CLIENT_EMAIL;
const privateKey = (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error("Missing Firebase creds in .env.local");
  process.exit(1);
}

const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
const auth = getAuth(app);
db.settings({ preferRest: true, ignoreUndefinedProperties: true });

async function run() {
  // ── Step 1: Load all applications ────────────────────────────────────────
  console.log("Loading applications...");
  const appsSnap = await db.collection("applications").get();
  const allDocs = appsSnap.docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() }));
  console.log(`  ${allDocs.length} total applications`);

  // Build uid → most-used ownerName (from apps that have ownerUid)
  const uidNameFreq = new Map(); // uid → { name → count }
  allDocs.forEach(({ data }) => {
    const uid = data.ownerUid || "";
    const name = data.ownerName || "";
    if (!uid || !name) return;
    if (!uidNameFreq.has(uid)) uidNameFreq.set(uid, new Map());
    const freq = uidNameFreq.get(uid);
    freq.set(name, (freq.get(name) || 0) + 1);
  });
  // uid → most-frequent stored name (latest name tends to win in frequency)
  const uidMostUsedName = new Map();
  for (const [uid, freq] of uidNameFreq) {
    const best = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) uidMostUsedName.set(uid, best[0]);
  }

  // ── Step 2: Load all userProfiles ────────────────────────────────────────
  console.log("Loading userProfiles...");
  const profilesSnap = await db.collection("userProfiles").get();
  console.log(`  ${profilesSnap.size} profile docs`);

  // Find docs with missing name
  const nameless = profilesSnap.docs.filter((d) => !d.data().name);
  const named = profilesSnap.docs.filter((d) => !!d.data().name);
  console.log(`  Named: ${named.map((d) => d.data().name).join(", ")}`);
  console.log(`  Nameless (need fix): ${nameless.map((d) => d.id).join(", ")}`);

  if (nameless.length === 0 && allDocs.every((d) => d.data.ownerUid)) {
    console.log("\nEverything looks clean already.");
    process.exit(0);
  }

  // ── Step 3: For each nameless profile, determine best name ───────────────
  const profileFixes = [];
  for (const doc of nameless) {
    const uid = doc.id;
    let name = "";

    // Try Firebase Auth display name first
    try {
      const authUser = await auth.getUser(uid);
      if (authUser.displayName) name = authUser.displayName;
      else if (authUser.email) name = authUser.email.split("@")[0];
    } catch {
      // uid not in auth (shouldn't happen but handle gracefully)
    }

    // Fall back to most-used ownerName from their applications
    if (!name) name = uidMostUsedName.get(uid) || "";
    if (!name) name = "User " + uid.slice(0, 6);

    console.log(`  uid ${uid} → will set name="${name}"`);
    profileFixes.push({ ref: doc.ref, name });
  }

  // ── Step 4: Backfill ownerUid on apps missing it ─────────────────────────
  // Build full name → uid map (from both sources)
  const allNameToUid = new Map();
  named.forEach((d) => allNameToUid.set(d.data().name, d.id));
  profileFixes.forEach(({ ref, name }) => allNameToUid.set(name, ref.id));
  // Also pull from apps-derived names
  for (const [uid, freq] of uidNameFreq) {
    for (const name of freq.keys()) {
      if (!allNameToUid.has(name)) allNameToUid.set(name, uid);
    }
  }

  const appFixes = [];
  const unresolved = [];
  allDocs.forEach(({ id, ref, data }) => {
    if (data.ownerUid) return; // already set
    const uid = allNameToUid.get(data.ownerName || "");
    if (uid) appFixes.push({ ref, ownerUid: uid, ownerName: data.ownerName });
    else unresolved.push(`${data.company || "?"} / "${data.ownerName || ""}"`);
  });

  // ── Step 5: Commit all fixes ─────────────────────────────────────────────
  console.log(`\nFixes to apply:`);
  console.log(`  userProfile name backfills: ${profileFixes.length}`);
  console.log(`  application ownerUid backfills: ${appFixes.length}`);
  if (unresolved.length) {
    console.log(`  unresolvable apps (will stay as-is): ${unresolved.length}`);
    unresolved.slice(0, 5).forEach((s) => console.log("    ", s));
  }

  if (profileFixes.length === 0 && appFixes.length === 0) {
    console.log("Nothing to write.");
    process.exit(0);
  }

  // Batch userProfiles fixes
  if (profileFixes.length > 0) {
    const batch = db.batch();
    profileFixes.forEach(({ ref, name }) => {
      batch.set(ref, { name, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await batch.commit();
    console.log(`\nUpdated ${profileFixes.length} userProfile(s).`);
  }

  // Batch app fixes in chunks of 500
  if (appFixes.length > 0) {
    let written = 0;
    for (let i = 0; i < appFixes.length; i += 500) {
      const batch = db.batch();
      appFixes.slice(i, i + 500).forEach(({ ref, ownerUid }) => {
        batch.update(ref, { ownerUid });
      });
      await batch.commit();
      written += Math.min(500, appFixes.length - i);
    }
    console.log(`Updated ${written} application(s) with ownerUid.`);
  }

  console.log("\nDone. Reload the app to see resolved names.");
}

run().catch((e) => { console.error(e); process.exit(1); });
