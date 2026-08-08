import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runtime maintenance toggle. middleware (Edge) can't read process.env at
// request time without a rebuild, so it consults this route instead — it runs
// on the Node runtime and reads MAINTENANCE_MODE fresh on every hit, so flipping
// the env var (e.g. docker compose restart or an exec) takes effect without a
// rebuild. Excluded from the middleware matcher so it's always answerable.
export async function GET() {
  const raw = process.env.MAINTENANCE_MODE || "";
  const on = raw === "true" || raw === "1";
  return NextResponse.json({ on });
}