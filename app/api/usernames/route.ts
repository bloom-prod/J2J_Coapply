import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";
import { resolveUserColor } from "@/lib/user-colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// uid -> name/color resolution for the whole group.
//
// This MUST stay a server endpoint using the Admin SDK. A client-side
// onSnapshot on `userProfiles` is rejected by the deployed Firestore rules
// ("Missing or insufficient permissions"), which silently leaves uidNameMap
// empty and makes every name in the feed and community views render as
// "Someone". That regression has been introduced twice now — see commit
// 07d6514. Don't swap this back to a client listener.
export async function GET(req: Request) {
  try {
    await requireUser(req);

    const snap = await adminDb.collection("userProfiles").get();
    const uidToName: Record<string, string> = {};
    const userColors: Record<string, string> = {};

    snap.docs.forEach((doc) => {
      const data = doc.data();
      const name = (data.name as string) || "Someone";
      uidToName[doc.id] = name;
      userColors[name] = resolveUserColor(doc.id, name, data.color as string | undefined);
    });

    return NextResponse.json({ ok: true, uidToName, userColors });
  } catch (err) {
    const status = err instanceof HttpError ? err.statusCode : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Server error" },
      { status }
    );
  }
}
