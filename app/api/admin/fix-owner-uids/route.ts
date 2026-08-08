/**
 * ONE-TIME migration (now obsolete): backfill ownerUid on applications that
 * were missing it.
 *
 * In the current Drizzle/Postgres schema applications.applicant_id is a NOT NULL
 * uuid FK to users.id, so every application is already keyed to its owner by the
 * database. There is no more free-text ownerUid / ownerName to repair, so this
 * endpoint is a no-op kept present to avoid breaking any imports.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireUser(req);
  return NextResponse.json({ ok: true, message: "no longer needed" });
}