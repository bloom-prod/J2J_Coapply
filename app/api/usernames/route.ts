import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireUser, HttpError } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_COLORS = ["#E07BA0","#7BB87B","#78AEDE","#DDB060","#A87BD4","#5FC5C5","#E8895A"];
const NAME_COLOR_OVERRIDES: Record<string, string> = { "Shruti": "#FF69B4" };

export async function GET(req: Request) {
  try {
    await requireUser(req);

    const snap = await adminDb.collection("userProfiles").get();
    const uidToName: Record<string, string> = {};
    const userColors: Record<string, string> = {};

    snap.docs.forEach((doc, i) => {
      const data = doc.data();
      const name = (data.name as string) || "Someone";
      const color = NAME_COLOR_OVERRIDES[name] || (data.color as string) || USER_COLORS[i % USER_COLORS.length];
      uidToName[doc.id] = name;
      userColors[name] = color;
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
