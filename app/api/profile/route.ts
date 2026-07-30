import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { pickColorForNewUser, resolveUserColor } from "@/lib/user-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const ref = adminDb.collection("userProfiles").doc(user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      // First time we've seen this user — create their profile now (rather than
      // only on their first manual edit) so they show up in community features
      // immediately, and assign a color once so it never shifts with snapshot order.
      const existingSnap = await adminDb.collection("userProfiles").get();
      // Resolve each existing user's *displayed* color (stored, or uid-hash for
      // legacy profiles without one) so the new user avoids all of them.
      const takenColors = existingSnap.docs.map((d) => {
        const x = d.data();
        return resolveUserColor(d.id, (x.name as string) || "Someone", x.color as string | undefined);
      });
      const color = pickColorForNewUser(user.uid, takenColors);
      await ref.set({
        name: user.name,
        email: user.email,
        color,
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({
        ok: true,
        profile: {
          uid: user.uid,
          name: user.name,
          email: user.email,
          color,
          githubUrl: "",
          linkedinUrl: "",
          websiteUrl: "",
          leetcodeRepoUrl: "",
          leetcodeLastSyncedAt: "",
        },
      });
    }
    const data = snap.data() as Record<string, unknown>;
    const name = (data.name as string) || user.name;
    return NextResponse.json({
      ok: true,
      profile: {
        uid: user.uid,
        name,
        email: (data.email as string) || user.email,
        // Same resolution as the charts/listeners use, so the Profile dialog
        // never shows a different color than the rest of the app.
        color: resolveUserColor(user.uid, name, data.color as string | undefined),
        githubUrl: (data.githubUrl as string) || "",
        linkedinUrl: (data.linkedinUrl as string) || "",
        websiteUrl: (data.websiteUrl as string) || "",
        leetcodeRepoUrl: (data.leetcodeRepoUrl as string) || "",
        leetcodeLastSyncedAt: (data.leetcodeLastSyncedAt as string) || "",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) throw new HttpError(400, "Name cannot be empty");
      updates.name = name;
      await adminAuth.updateUser(user.uid, { displayName: name });
    }
    if (body.githubUrl !== undefined) updates.githubUrl = String(body.githubUrl || "").trim();
    if (body.linkedinUrl !== undefined) updates.linkedinUrl = String(body.linkedinUrl || "").trim();
    if (body.websiteUrl !== undefined) updates.websiteUrl = String(body.websiteUrl || "").trim();
    if (body.leetcodeRepoUrl !== undefined) {
      const url = String(body.leetcodeRepoUrl || "").trim();
      if (url && !isValidUrl(url)) {
        throw new HttpError(400, "Invalid LeetCode repo URL");
      }
      updates.leetcodeRepoUrl = url;
      if (url) updates.leetcodeLastSyncedAt = ""; // Reset sync time when connecting
    }
    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "No fields to update");
    }

    const ref = adminDb.collection("userProfiles").doc(user.uid);
    await ref.set(
      { ...updates, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
