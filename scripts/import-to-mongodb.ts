/**
 * Firestore to MongoDB Import Script
 * Imports exported Firestore JSON files into MongoDB
 */

import { MongoClient, Db } from "mongodb";
import * as fs from "fs";
import * as path from "path";

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || "firestore_import";

async function connectToMongo(): Promise<{ client: MongoClient; db: Db }> {
  console.log(`🔌 Connecting to MongoDB at ${MONGO_URI}...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(MONGO_DB_NAME);
  console.log(`✅ Connected to database: ${MONGO_DB_NAME}`);
  return { client, db };
}

async function importCollection(
  db: Db,
  filePath: string,
  collectionName: string
): Promise<{ imported: number; errors: number }> {
  console.log(`\n📥 Importing ${collectionName}...`);

  const content = fs.readFileSync(filePath, "utf-8");
  const documents = JSON.parse(content);

  const collection = db.collection(collectionName);

  // Convert documents object to array with _id field
  const docsArray = Object.entries(documents).map(([docId, data]: [string, any]) => ({
    _id: docId,
    ...data,
  }));

  if (docsArray.length === 0) {
    console.log(`   ⚠️  No documents to import`);
    return { imported: 0, errors: 0 };
  }

  // Clear existing data and insert new
  await collection.deleteMany({});

  let imported = 0;
  let errors = 0;

  // Insert in batches of 1000
  const batchSize = 1000;
  for (let i = 0; i < docsArray.length; i += batchSize) {
    const batch = docsArray.slice(i, i + batchSize);
    try {
      await collection.insertMany(batch, { ordered: false });
      imported += batch.length;
      process.stdout.write(`   Progress: ${imported}/${docsArray.length}\r`);
    } catch (error: any) {
      // Some documents might have been inserted
      if (error.writeErrors) {
        imported += batch.length - error.writeErrors.length;
        errors += error.writeErrors.length;
      } else {
        errors += batch.length;
      }
    }
  }

  console.log(`   ✅ Imported ${imported} documents ${errors > 0 ? `(${errors} errors)` : ""}`);
  return { imported, errors };
}

async function main() {
  console.log("🚀 Firestore to MongoDB Import");
  console.log("==============================\n");

  // Get the backup directory from command line or find the most recent
  let backupDir = process.argv[2];

  if (!backupDir) {
    const backupRoot = path.join(process.cwd(), "firestore-backup");
    if (!fs.existsSync(backupRoot)) {
      console.error("❌ No backup directory found. Please run export first.");
      console.error("   Usage: npx ts-node scripts/import-to-mongodb.ts <backup-directory>");
      process.exit(1);
    }

    // Find the most recent backup
    const backups = fs
      .readdirSync(backupRoot)
      .filter((dir) => fs.statSync(path.join(backupRoot, dir)).isDirectory())
      .sort()
      .reverse();

    if (backups.length === 0) {
      console.error("❌ No backup directories found in firestore-backup/");
      process.exit(1);
    }

    backupDir = path.join(backupRoot, backups[0]);
  }

  if (!fs.existsSync(backupDir)) {
    console.error(`❌ Backup directory not found: ${backupDir}`);
    process.exit(1);
  }

  console.log(`📂 Using backup directory: ${backupDir}`);

  try {
    const { client, db } = await connectToMongo();

    // Find all JSON files except _summary.json
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith(".json") && f !== "_summary.json")
      .sort();

    console.log(`\n📚 Found ${files.length} collection files to import`);

    const results: Record<string, { imported: number; errors: number }> = {};

    for (const file of files) {
      const collectionName = file.replace(".json", "");
      const filePath = path.join(backupDir, file);
      results[collectionName] = await importCollection(db, filePath, collectionName);
    }

    // Print summary
    console.log(`\n\n${"=".repeat(60)}`);
    console.log("📊 IMPORT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Database: ${MONGO_DB_NAME}`);
    console.log(`Collections imported: ${files.length}`);
    console.log("\nCollection details:");

    Object.entries(results).forEach(([name, data]) => {
      const status = data.errors > 0 ? `⚠️  (${data.errors} errors)` : "✅";
      console.log(`  ${name}: ${data.imported} documents ${status}`);
    });

    const totalImported = Object.values(results).reduce((sum, r) => sum + r.imported, 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);

    console.log(`\nTotal: ${totalImported} documents imported ${totalErrors > 0 ? `(${totalErrors} errors)` : ""}`);
    console.log("\n✅ Import complete!");

    await client.close();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
