/**
 * Firestore Schema Inspector
 * Lists all collections and sample documents to understand the database structure
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin
function initAdmin() {
  if (getApps().length > 0) {
    return getFirestore();
  }
  
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
  // Handle both escaped newlines (\n) and actual newlines
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  // If it starts with quotes, remove them
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase Admin credentials!");
    console.error("Required env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
    process.exit(1);
  }
  
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey })
  });
  
  return getFirestore();
}

async function inspectCollection(db: FirebaseFirestore.Firestore, collectionName: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📁 COLLECTION: ${collectionName}`);
  console.log("=".repeat(60));
  
  const snapshot = await db.collection(collectionName).limit(5).get();
  
  if (snapshot.empty) {
    console.log("   (empty collection)");
    return { count: 0, fields: new Set<string>() };
  }
  
  const allFields = new Set<string>();
  
  snapshot.docs.forEach((doc, index) => {
    const data = doc.data();
    console.log(`\n   📄 Document ${index + 1}: ${doc.id}`);
    console.log(`   Fields:`);
    
    Object.entries(data).forEach(([key, value]) => {
      const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      const preview = type === "object" && value !== null 
        ? JSON.stringify(value).slice(0, 50) + "..."
        : String(value).slice(0, 50);
      console.log(`      - ${key}: ${type} = ${preview}`);
      allFields.add(key);
    });
  });
  
  // Get total count
  const countSnapshot = await db.collection(collectionName).count().get();
  const count = countSnapshot.data().count;
  
  console.log(`\n   📊 Total documents: ${count}`);
  console.log(`   📋 All field names: ${Array.from(allFields).join(", ")}`);
  
  return { count, fields: allFields };
}

async function main() {
  console.log("🔍 Firestore Schema Inspector");
  console.log("=====================================\n");
  
  try {
    const db = initAdmin();
    
    // List all root collections
    console.log("📚 Finding root collections...");
    const collections = await db.listCollections();
    
    console.log(`\nFound ${collections.length} collections:`);
    collections.forEach((col, i) => {
      console.log(`  ${i + 1}. ${col.id}`);
    });
    
    // Inspect each collection
    const results: Record<string, { count: number; fields: Set<string> }> = {};
    
    for (const collection of collections) {
      results[collection.id] = await inspectCollection(db, collection.id);
    }
    
    // Summary
    console.log(`\n\n${"=".repeat(60)}`);
    console.log("📈 SUMMARY");
    console.log("=".repeat(60));
    Object.entries(results).forEach(([name, data]) => {
      console.log(`  ${name}: ${data.count} documents`);
    });
    
    // Specific checks for the bugs
    console.log(`\n\n${"=".repeat(60)}`);
    console.log("🔍 Bug Investigation");
    console.log("=".repeat(60));
    
    // Check userProfiles
    if (results["userProfiles"]) {
      console.log("\n✅ userProfiles collection exists");
      const userProfiles = await db.collection("userProfiles").get();
      console.log(`   Total userProfiles: ${userProfiles.size}`);
      
      if (userProfiles.size > 0) {
        console.log("\n   Sample userProfiles:");
        userProfiles.docs.slice(0, 3).forEach((doc) => {
          const data = doc.data();
          console.log(`     - ${doc.id}: name="${data.name || "N/A"}", color="${data.color || "N/A"}"`);
        });
      }
    } else {
      console.log("\n❌ userProfiles collection NOT FOUND!");
    }
    
    // Check applications
    if (results["applications"]) {
      console.log("\n✅ applications collection exists");
      const apps = await db.collection("applications").limit(10).get();
      
      // Count unique ownerUids
      const ownerUids = new Set<string>();
      const missingOwnerUid: string[] = [];
      
      apps.docs.forEach((doc) => {
        const data = doc.data();
        if (data.ownerUid) {
          ownerUids.add(data.ownerUid);
        } else {
          missingOwnerUid.push(doc.id);
        }
      });
      
      console.log(`   Sample applications: ${apps.docs.length}`);
      console.log(`   Unique ownerUids in sample: ${ownerUids.size}`);
      console.log(`   Applications missing ownerUid: ${missingOwnerUid.length}`);
      
      // Check role categories
      const roleCategories = new Map<string, number>();
      apps.docs.forEach((doc) => {
        const data = doc.data();
        const cat = data.roleCategory || "(none)";
        roleCategories.set(cat, (roleCategories.get(cat) || 0) + 1);
      });
      
      console.log("\n   Role categories in sample:");
      roleCategories.forEach((count, cat) => {
        console.log(`     - ${cat}: ${count} applications`);
      });
    }
    
    console.log("\n✅ Inspection complete!");
    process.exit(0);
    
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
