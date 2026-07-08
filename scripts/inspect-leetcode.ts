/**
 * Firestore LeetCode Problems Inspector
 * Checks the leetcodeProblems subcollection structure
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function initAdmin() {
  if (getApps().length > 0) {
    return getFirestore();
  }
  
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
  
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase Admin credentials!");
    process.exit(1);
  }
  
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey })
  });
  
  return getFirestore();
}

async function inspectLeetCodeProblems(db: FirebaseFirestore.Firestore) {
  console.log("🔍 Inspecting leetcodeProblems subcollections...\n");
  
  // Get all userProfiles
  const userProfiles = await db.collection("userProfiles").get();
  console.log(`Found ${userProfiles.size} userProfiles\n`);
  
  let totalProblems = 0;
  const problemsByUser: Record<string, number> = {};
  
  for (const userDoc of userProfiles.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data();
    const userName = userData.name || "Unknown";
    
    // Check for leetcodeProblems subcollection
    const problemsSnapshot = await db
      .collection("userProfiles")
      .doc(uid)
      .collection("leetcodeProblems")
      .get();
    
    problemsByUser[uid] = problemsSnapshot.size;
    totalProblems += problemsSnapshot.size;
    
    if (problemsSnapshot.size > 0) {
      console.log(`\n📁 User: ${userName} (${uid})`);
      console.log(`   Problems count: ${problemsSnapshot.size}`);
      
      // Show sample document structure
      if (problemsSnapshot.docs.length > 0) {
        const sample = problemsSnapshot.docs[0];
        const data = sample.data();
        console.log(`   Sample problem (${sample.id}):`);
        Object.entries(data).forEach(([key, value]) => {
          const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
          const preview = String(value).slice(0, 40);
          console.log(`      - ${key}: ${type} = ${preview}`);
        });
      }
    }
  }
  
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("📊 Summary");
  console.log("=".repeat(60));
  console.log(`Total userProfiles: ${userProfiles.size}`);
  console.log(`Total leetcodeProblems: ${totalProblems}`);
  console.log("\nProblems by user:");
  Object.entries(problemsByUser)
    .filter(([_, count]) => count > 0)
    .forEach(([uid, count]) => {
      const userDoc = userProfiles.docs.find(d => d.id === uid);
      const name = userDoc?.data().name || "Unknown";
      console.log(`  - ${name} (${uid.slice(0, 8)}...): ${count} problems`);
    });
  
  return { totalProblems, problemsByUser };
}

async function main() {
  try {
    const db = initAdmin();
    await inspectLeetCodeProblems(db);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
