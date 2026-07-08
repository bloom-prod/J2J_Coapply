import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ── Maintenance mode ──────────────────────────────────────────────────────
// Serves a friendly maintenance page for every request and short-circuits all
// API routes so we stop consuming Firestore read quota while the backend is
// being worked on. Flip MAINTENANCE to false (and redeploy) to bring the site
// back up.
const MAINTENANCE = false;

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

export function middleware(req: NextRequest) {
  if (!MAINTENANCE) return NextResponse.next();

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
  matcher: ["/((?!_next/static|_next/image).*)"],
};
