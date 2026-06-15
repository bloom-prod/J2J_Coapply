# 🌿 bloom tracker

A community job-application tracker. Each person tracks their own applications; everyone
shares one community garden with pooled stats, charts, a leaderboard, and a live activity feed.

- **Framework:** Next.js 14 (App Router) + TypeScript + Tailwind + **shadcn/ui**
- **Charts:** Recharts (shadcn chart style)
- **Backend:** Next.js **Route Handlers** (`app/api/*`) using `firebase-admin`
- **Data/Auth:** Firebase **Firestore** + **Email/Password Authentication**
- **Hosting:** Netlify (or Vercel)

## Architecture

```
Browser ──(Firebase Auth, email/password)──► Firebase Auth
   │  reads (live):  onSnapshot ─────────────► Firestore  (read-only rules)
   │  writes:        fetch + ID token ──► /api/applications (firebase-admin) ──► Firestore
```

All **writes** go through the TypeScript route handlers (token-verified, ownership-checked,
also emit feed events). All **reads** stream live from Firestore via `onSnapshot`, so the
shared pool, stats, charts, leaderboard, and feed update in real time. Firestore rules deny
client writes entirely — the Admin SDK on the server bypasses them.

> ⚠️ **Privacy:** full shared pool — every signed-in user can read everyone's application
> records. To restrict, tighten `firestore.rules` and serve per-user data from the API.

## Project layout

```
app/
  layout.tsx           # root layout + Toaster
  page.tsx             # client orchestrator: auth gate, top bar, tabs, dialog
  globals.css          # Tailwind + shadcn tokens + the bloom stylesheet (ported verbatim)
  api/applications/route.ts   # POST/PUT/DELETE (auth + ownership + feed)
  api/stats/route.ts          # GET community aggregates
components/
  ui/                  # shadcn primitives (button, card, dialog, select, tabs, …)
  auth-screen, app page tabs (tracker/insights/timeline/forest/community), application-dialog
hooks/use-bloom.ts     # auth state + live snapshots + optimistic writes
lib/                   # firebase (client), firebase-admin, auth-server, types, job-utils
firestore.rules
legacy/                # the previous single-file app + Netlify functions (archived)
```

## Setup

### 1. Firebase project
1. Create a project → **Authentication → Sign-in method → Email/Password → Enable**.
2. **Firestore Database → Create database** (Native mode, production rules).
3. Deploy `firestore.rules` (Console → Firestore → Rules → paste → Publish).
4. **Authentication → Settings → Authorized domains** — add `localhost` and your deploy domain.

### 2. Environment — one file: `.env.local`
Copy `.env.local.example` → `.env.local` and fill it in. It holds **both** the public web
config (`NEXT_PUBLIC_*`, safe in the browser) and the secret admin service account
(server-only). `.env.local` is git-ignored. See `.env.local.example` for the full list.

In production, set the **same variables** in your host's dashboard
(Netlify/Vercel → Environment variables) instead of a file.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
```

`npm run build` for a production build, `npm run typecheck` to type-check.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/applications` | Create an application (+ feed event) |
| `PUT` | `/api/applications` | Update own application (status change → feed event) |
| `DELETE` | `/api/applications` | Delete own application |
| `GET` | `/api/stats` | Community aggregates |

All require `Authorization: Bearer <Firebase ID token>`.

## Data model (Firestore)

- `applications/{id}` — `company, role, status, priority, location, date, salary, url,
  recruiter, followup, notes, starred, ownerUid, ownerName, createdAt, updatedAt`
- `feed/{id}` — `type ('applied'|'status'|'offer'), company, role, status, ownerName, ts`
