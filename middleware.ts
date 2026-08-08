import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ── Maintenance mode ──────────────────────────────────────────────────────
// Serves a friendly maintenance page for every request and short-circuits all
// API routes. Unlike a hardcoded constant, this is a RUNTIME toggle: Next 14
// inlines statically-referenced process.env in Edge middleware at build time,
// so we read the flag from the /api/maintenance route instead. That route runs
// on the Node runtime and reads MAINTENANCE_MODE fresh per request (and is
// excluded from this middleware's matcher so it never short-circuits itself).
// Flipping MAINTENANCE_MODE=true|1 (or unsetting it) + `docker compose restart`
// brings the site up/down without a rebuild. We cache the answer briefly to
// avoid hammering the flag route; the middleware fails OPEN (site stays up) if
// the flag can't be reached.

const FLAG_TTL_MS = 30 * 1000;
let cachedOn = false;
let lastCheck = 0;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function maintenanceIsOn(req: NextRequest): Promise<boolean> {
  const now = Date.now();
  if (now - lastCheck < FLAG_TTL_MS) return cachedOn;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${req.nextUrl.origin}/api/maintenance`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const d = await res.json().catch(() => null);
      cachedOn = Boolean(d && d.on);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    cachedOn = false; // fail open — don't take the site down on a hiccup
  }
  lastCheck = now;
  return cachedOn;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>bloom tracker 🌿 — back soon</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(160deg, #FDF6FA 0%, #F1F7F0 100%);
    color: #4B4453; padding: 24px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: linear-gradient(160deg, #221F2E 0%, #1B2320 100%); color: #E9E4F2; }
    .card { background: rgba(45,42,60,.6); border-color: rgba(255,255,255,.06); }
    .sub { color: #A89EC0; }
  }
  .card {
    max-width: 460px; width: 100%; text-align: center;
    background: rgba(255,255,255,.7); backdrop-filter: blur(8px);
    border: 1px solid rgba(0,0,0,.05); border-radius: 22px;
    padding: 44px 34px; box-shadow: 0 12px 40px rgba(0,0,0,.08);
  }
  .icon { font-size: 56px; line-height: 1; margin-bottom: 14px; }
  h1 { font-size: 24px; margin: 0 0 10px; font-weight: 700; }
  .sub { font-size: 15px; line-height: 1.55; color: #6B5E52; margin: 0; }
  .tag { margin-top: 22px; font-size: 12px; letter-spacing: .5px; text-transform: uppercase; opacity: .6; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🌿</div>
    <h1>We're tending the garden</h1>
    <p class="sub">bloom tracker is down for a bit of maintenance. Your applications are safe — we'll be back up shortly. Thanks for your patience! 🌸</p>
    <div class="tag">bloom tracker · maintenance</div>
  </div>
</body>
</html>`;

export async function middleware(req: NextRequest) {
  const maintenance = await maintenanceIsOn(req);
  if (!maintenance) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Let static assets through so the favicon still resolves.
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.svg" ||
    pathname.startsWith("/android-chrome")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json(
      { ok: false, error: "bloom tracker is under maintenance — back soon." },
      { status: 503, headers: { "Retry-After": "3600" } }
    );
  }

  return new NextResponse(PAGE, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Retry-After": "3600",
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/maintenance).*)"],
};
