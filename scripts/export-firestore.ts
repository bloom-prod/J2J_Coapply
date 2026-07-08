/**
 * Firestore Data Exporter
 * Exports all Firestore collections and documents to JSON files
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

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
    console.error(
      "Required env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
    process.exit(1);
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  return getFirestore();
}

// Helper to convert Firestore timestamps to ISO strings
function convertTimestamps(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (data._seconds !== undefined && data._nanoseconds !== undefined) {
    // Firestore Timestamp
    return new Date(data._seconds * 1000).toISOString();
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (Array.isArray(data)) {
    return data.map(convertTimestamps);
  }

  if (typeof data === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = convertTimestamps(value);
    }
    return result;
  }

  return data;
}

async function exportCollection(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  outputDir: string
): Promise<{ count: number; exported: boolean }> {
  console.log(`\n📁 Exporting collection: ${collectionName}...`);

  const snapshot = await db.collection(collectionName).get();

  if (snapshot.empty) {
    console.log(`   ⚠️  Collection is empty`);
    return { count: 0, exported: false };
  }

  const documents: Record<string, any> = {};

  snapshot.docs.forEach((doc) => {
    documents[doc.id] = convertTimestamps(doc.data());
  });

  // Save to JSON file
  const outputPath = path.join(outputDir, `${collectionName}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(documents, null, 2));

  console.log(`   ✅ Exported ${snapshot.size} documents to ${outputPath}`);
  return { count: snapshot.size, exported: true };
}

async function main() {
  console.log("🔥 Firestore Data Exporter");
  console.log("==========================\n");

  try {
    const db = initAdmin();

    // Create output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = path.join(process.cwd(), "firestore-backup", timestamp);
    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`📂 Output directory: ${outputDir}`);

    // List all root collections
    console.log("\n📚 Finding collections...");
    const collections = await db.listCollections();

    console.log(`\nFound ${collections.length} collections:`);
    collections.forEach((col, i) => {
      console.log(`  ${i + 1}. ${col.id}`);
    });

    // Export each collection
    const results: Record<string, { count: number; exported: boolean }> = {};

    for (const collection of collections) {
      results[collection.id] = await exportCollection(
        db,
        collection.id,
        outputDir
      );
    }

    // Create summary file
    const summary = {
      exportDate: new Date().toISOString(),
      totalCollections: collections.length,
      collections: results,
    };

    const summaryPath = path.join(outputDir, "_summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    // Print summary
    console.log(`\n\n${"=".repeat(60)}`);
    console.log("📊 EXPORT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Export location: ${outputDir}`);
    console.log(`Total collections: ${collections.length}`);
    console.log("\nCollection details:");

    Object.entries(results).forEach(([name, data]) => {
      console.log(`  ${name}: ${data.count} documents ${data.exported ? "✅" : "⚠️"}`);
    });

    console.log(`\n✅ Export complete! Files saved to: ${outputDir}`);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
