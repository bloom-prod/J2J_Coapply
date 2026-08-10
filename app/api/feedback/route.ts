import { NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/auth-server";
import { sendFeedbackEmail } from "@/lib/mailer";
import { rateLimiter, clientIp, RATE_LIMIT_WINDOW_MS, IP_LIMITS } from "@/lib/rate-limit";
import { getUserCommunityId } from "@/lib/community";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TITLE = 200;
const MAX_BODY = 5000;

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const ip = clientIp(req);

    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const type = String(raw.type || "").trim();
    if (type !== "bug" && type !== "feature") {
      throw new HttpError(400, "Type must be 'bug' or 'feature'");
    }
    const title = String(raw.title || "").trim();
    const body = String(raw.body || "").trim();
    if (!title) throw new HttpError(400, "Title is required");
    if (!body) throw new HttpError(400, "Description is required");
    if (title.length > MAX_TITLE) throw new HttpError(400, `Title must be at most ${MAX_TITLE} characters`);
    if (body.length > MAX_BODY) throw new HttpError(400, `Description must be at most ${MAX_BODY} characters`);

    if (!rateLimiter.hit(`feedback:user:${user.id}`, IP_LIMITS.feedback, RATE_LIMIT_WINDOW_MS)) {
      logger.warn("feedback.rate_limited", { uid: user.id, ip });
      throw new HttpError(429, "Too many feedback submissions. Please wait and try again in 15 minutes.");
    }
    if (!rateLimiter.hit(`feedback:ip:${ip}`, IP_LIMITS.feedback, RATE_LIMIT_WINDOW_MS)) {
      logger.warn("feedback.rate_limited", { uid: user.id, ip });
      throw new HttpError(429, "Too many feedback submissions. Please wait and try again in 15 minutes.");
    }

    let communityId: string | null = null;
    try {
      communityId = await getUserCommunityId(user.id, req);
    } catch {
      // Optional context only — users without a community can still send feedback.
      communityId = null;
    }

    const to = process.env.FEEDBACK_TO || "admin@pxndey.com";

    try {
      await sendFeedbackEmail({
        to,
        fromUserEmail: user.email,
        fromUserName: user.name,
        fromUserId: user.id,
        type,
        title,
        body,
        communityId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("feedback.send_failed", { uid: user.id, err: msg });
      if (msg.includes("SMTP") || msg.includes("Missing SMTP")) {
        throw new HttpError(500, "Email is not configured (missing SMTP). Feedback could not be sent.");
      }
      throw new HttpError(500, "Failed to send feedback email. Please try again later.");
    }

    logger.info("feedback.sent", { uid: user.id, type, title });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    return fail(500, err instanceof Error ? err.message : "Server error");
  }
}
