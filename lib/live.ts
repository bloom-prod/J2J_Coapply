import postgres from "postgres";

// Postgres LISTEN/NOTIFY pub/sub so clients get pushed refresh signals instead
// of hammering the DB with a 15s whole-table poll.
//
// A single channel ("bloom_changes") is used for all mutations: the client
// refetches its small set of endpoints on any change. Keeping one channel is
// simpler than per-table channels and fits the current client (it only reads
// /api/applications and /api/feed).
export const LIVE_CHANNEL = "bloom_changes";

// Lazy, single-connection notifier used by the write routes. Fire-and-forget:
// if NOTIFY fails (e.g. transient), the client's slow fallback poll still picks
// the change up, so we never let a publish error break a mutation.
let notifier: ReturnType<typeof postgres> | null = null;

function getNotifier() {
  if (notifier) return notifier;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL — pub/sub needs Postgres.");
  notifier = postgres(url, { max: 1, max_lifetime: 60 * 5 });
  return notifier;
}

export function notifyChanges(payload = "refresh") {
  try {
    const sql = getNotifier();
    void sql
      .notify(LIVE_CHANNEL, payload)
      .catch((e) => console.error("[live] NOTIFY failed:", e));
  } catch (e) {
    console.error("[live] notify error:", e);
  }
}