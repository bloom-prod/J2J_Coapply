import postgres from "postgres";
import { verifyToken } from "@/lib/jwt";
import { LIVE_CHANNEL } from "@/lib/live";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events: bubbly any `bloom_changes` NOTIFY as a `refresh` event so
// the client can refetch instead of polling. EventSource can't set an
// Authorization header, so the JWT travels as a short-lived query param for the
// duration of this stream (the data it triggers is still fetched with the
// Bearer header). A `: ping` comment every 25s keeps proxies from idle-timeout
// killing the connection.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return new Response("Unauthorized", { status: 401 });
  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!payload.sub) return new Response("Unauthorized", { status: 401 });

  logger.info("sse.connect", { uid: payload.sub });

  const url = process.env.DATABASE_URL;
  if (!url) return new Response("Server error", { status: 500 });
  const sql = postgres(url, { max: 1 });

  const encoder = new TextEncoder();
  const send = (data: string) => encoder.encode(data);

  const stream = new ReadableStream({
    start(controller) {
      let finished = false;
      let ping: ReturnType<typeof setInterval> | null = null;
      let unlisten: (() => void) | null = null;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        logger.info("sse.close", { uid: payload.sub });
        try {
          if (ping) clearInterval(ping);
          if (unlisten) unlisten();
          void sql.end({ timeout: 0 }).catch(() => {});
        } catch {
          /* already closed */
        }
      };

      const push = (event: string, data: string) => {
        if (finished) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };

      void sql
        .listen(LIVE_CHANNEL, (msg) => push("refresh", msg || "refresh"))
        .then((sub) => {
          if (finished) {
            sub.unlisten();
            return;
          }
          unlisten = sub.unlisten;
          // Kick a refresh on connect so a subscriber syncs immediately.
          push("refresh", "refresh");
        })
        .catch(() => {
          cleanup();
        });

      ping = setInterval(() => push("ping", "refresh"), 25000);

      // Tear down when the client disconnects. Request.signal is an
      // AbortSignal available in Node 18+.
      req.signal?.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}