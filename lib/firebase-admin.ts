import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getStorage, type Storage } from "firebase-admin/storage";
import { getDatabase, type Database } from "firebase-admin/database";

// Admin SDK — server-only (imported exclusively from Route Handlers).
function getAdminApp(): App {
  const apps = getApps();
  if (apps.length) return apps[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin credentials — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY."
    );
  }
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;
  const databaseURL = process.env.FIREBASE_DATABASE_URL || `https://${projectId}.firebaseio.com`;
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), storageBucket, databaseURL });
}

function makeDb(): Firestore {
  const d = getFirestore(getAdminApp());
  try {
    d.settings({ preferRest: true, ignoreUndefinedProperties: true });
  } catch {
    /* settings already applied */
  }
  return d;
}

let cachedRtDb: Database | null = null;

function makeRealtimeDb(): Database {
  if (!cachedRtDb) {
    cachedRtDb = getDatabase(getAdminApp());
  }
  return cachedRtDb;
}

export const adminDb: Firestore = makeDb();
export const adminAuth: Auth = getAuth(getAdminApp());
export const adminStorage: Storage = getStorage(getAdminApp());
export { makeRealtimeDb as getRtDb };
