/**
 * Migration: Move leetcodeProblems from subcollection to root collection
 * 
 * Strategy:
 * 1. Read all leetcodeProblems from userProfiles/{uid}/leetcodeProblems
 * 2. Create new documents in root leetcodeProblems collection with userId field
 * 3. Delete old subcollection documents (optional, commented out for safety)
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

async function migrateLeetCodeProblems(db: FirebaseFirestore.Firestore) {
  console.log("🚀 Starting leetcodeProblems migration...\n");
  
  // Get all userProfiles
  const userProfiles = await db.collection("userProfiles").get();
  console.log(`Found ${userProfiles.size} userProfiles\n`);
  
  let migratedCount = 0;
  const batch = db.batch();
  let batchCount = 0;
  const BATCH_SIZE = 500; // Firestore batch limit
  
  for (const userDoc of userProfiles.docs) {
    const uid = userDoc.id;
    const userName = userDoc.data().name || "Unknown";
    
    // Get all problems from subcollection
    const problemsSnapshot = await db
      .collection("userProfiles")
      .doc(uid)
      .collection("leetcodeProblems")
      .get();
    
    if (problemsSnapshot.empty) {
      console.log(`  No problems for user: ${userName} (${uid})`);
      continue;
    }
    
    console.log(`\n📦 Migrating ${problemsSnapshot.size} problems for user: ${userName} (${uid})`);
    
    for (const problemDoc of problemsSnapshot.docs) {
      const problemData = problemDoc.data();
      
      // Create new document in root collection with userId field
      const newDocRef = db.collection("leetcodeProblems").doc(problemDoc.id);
      
      // Convert syncedAt Timestamp to ISO string if it exists
      let syncedAt = problemData.syncedAt;
      if (syncedAt instanceof Timestamp) {
        syncedAt = syncedAt.toDate().toISOString();
      }
      
      batch.set(newDocRef, {
        problemId: problemData.problemId,
        title: problemData.title,
        difficulty: problemData.difficulty,
        language: problemData.language,
        commitHash: problemData.commitHash || "",
        solvedAt: problemData.solvedAt,
        syncedAt: syncedAt,
        userId: uid, // Add userId to link back to user
        userName: userName, // Add denormalized userName for convenience
        migratedAt: new Date().toISOString(),
      });
      
      migratedCount++;
      batchCount++;
      
      // Commit batch if it reaches the limit
      if (batchCount >= BATCH_SIZE) {
        console.log(`\n💾 Committing batch of ${batchCount} documents...`);
        await batch.commit();
        batchCount = 0;
      }
    }
  }
  
  // Commit remaining documents
  if (batchCount > 0) {
    console.log(`\n💾 Committing final batch of ${batchCount} documents...`);
    await batch.commit();
  }
  
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("✅ Migration Complete!");
  console.log("=".repeat(60));
  console.log(`Total problems migrated: ${migratedCount}`);
  console.log("\nThe problems are now in the root 'leetcodeProblems' collection");
  console.log("Each document has a 'userId' field linking it to the userProfile");
  
  // Verify migration
  console.log("\n🔍 Verifying migration...");
  const newCollection = await db.collection("leetcodeProblems").get();
  console.log(`New collection has ${newCollection.size} documents`);
  
  if (newCollection.size > 0) {
    console.log("\nSample migrated document:");
    const sample = newCollection.docs[0].data();
    console.log(`  - ${newCollection.docs[0].id}:`);
    Object.entries(sample).forEach(([key, value]) => {
      console.log(`      ${key}: ${value}`);
    });
  }
}

async function main() {
  try {
    const db = initAdmin();
    await migrateLeetCodeProblems(db);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
