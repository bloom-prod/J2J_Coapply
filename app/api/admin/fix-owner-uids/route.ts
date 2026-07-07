/**
 * ONE-TIME migration: backfill ownerUid on any application that is missing it.
 *
 * Strategy:
 *   1. Load all userProfiles  → uid → currentName
 *   2. Load all applications
 *   3. From apps that already have ownerUid, build a name → uid reverse map
 *      (this captures old/stale ownerNames that have since been changed, since
 *       those jobs still carry the old name string but do have ownerUid set).
 *   4. For apps with no ownerUid, look up ownerName in that reverse map
 *      (falling back to the userProfiles name map).
 *   5. Batch-write ownerUid onto every app that was resolved.
 *
 * Only callable by Shruti (admin). Delete this file after running once.
 */

import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "shrutiagarwal921@gmail.com";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    // Gate to admin only
    const authUser = await adminAuth.getUser(user.uid);
    if (authUser.email !== ADMIN_EMAIL) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // 1. Load all userProfiles → uid → currentName
    const profilesSnap = await adminDb.collection("userProfiles").get();
    const uidToName = new Map<string, string>();
    const profileNameToUid = new Map<string, string>();
    profilesSnap.docs.forEach((d) => {
      const name = (d.data().name as string) || "";
      if (name) {
        uidToName.set(d.id, name);
        profileNameToUid.set(name, d.id);
      }
    });

    // 2. Load all applications
    const appsSnap = await adminDb.collection("applications").get();
    const allDocs = appsSnap.docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() }));

    // 3. Build name → uid from apps that already have ownerUid
    //    This captures old ownerName values used before a rename.
    const appNameToUid = new Map<string, string>();
    allDocs.forEach(({ data }) => {
      const uid = (data.ownerUid as string) || "";
      const name = (data.ownerName as string) || "";
      if (uid && name && !appNameToUid.has(name)) {
        appNameToUid.set(name, uid);
      }
    });

    // Merge: app-derived names take priority (capture old names), profiles as fallback
    const nameToUid = new Map<string, string>([...profileNameToUid, ...appNameToUid]);

    // 4. Find docs missing ownerUid and resolve
    const toFix: Array<{ ref: FirebaseFirestore.DocumentReference; ownerUid: string }> = [];
    const unresolved: string[] = [];

    allDocs.forEach(({ ref, data }) => {
      const existingUid = (data.ownerUid as string) || "";
      if (existingUid) return; // already has ownerUid — skip

      const ownerName = (data.ownerName as string) || "";
      const resolvedUid = ownerName ? nameToUid.get(ownerName) : undefined;

      if (resolvedUid) {
        toFix.push({ ref, ownerUid: resolvedUid });
      } else {
        unresolved.push(`${data.company || "?"} / ${ownerName || "no-name"}`);
      }
    });

    // 5. Batch-write in chunks of 500 (Firestore batch limit)
    let written = 0;
    for (let i = 0; i < toFix.length; i += 500) {
      const batch = adminDb.batch();
      toFix.slice(i, i + 500).forEach(({ ref, ownerUid }) => {
        batch.update(ref, { ownerUid });
      });
      await batch.commit();
      written += Math.min(500, toFix.length - i);
    }

    return NextResponse.json({
      ok: true,
      totalApps: allDocs.length,
      alreadyHadUid: allDocs.length - toFix.length - unresolved.length,
      fixed: written,
      unresolved: unresolved.length,
      unresolvedSamples: unresolved.slice(0, 10),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
