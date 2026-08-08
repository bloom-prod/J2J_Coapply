import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyToken } from "./jwt";
import { logger } from "./logger";

export interface AuthedUser {
  id: string; // postgres uuid
  uid: string; // alias of id, kept for a drop-in swap during migration
  name: string;
  email: string;
  isAdmin: boolean;
}

// Request identity for logging (never the token itself).
function reqMeta(req: Request) {
  const url = new URL(req.url);
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "").split(",")[0].trim();
  return { method: req.method, path: url.pathname, ip: ip || undefined };
}

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Verify the JWT from the Authorization header and load the user from the DB.
export async function requireUser(req: Request): Promise<AuthedUser> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    logger.warn("auth.fail", { reason: "missing_bearer", ...reqMeta(req) });
    throw new HttpError(401, "Missing Authorization bearer token");
  }

  let payload: { sub: string } | undefined;
  try {
    payload = await verifyToken(match[1]);
  } catch {
    logger.warn("auth.fail", { reason: "invalid_token", ...reqMeta(req) });
    throw new HttpError(401, "Invalid or expired token");
  }

  const row = await db.query.users.findFirst({
    where: eq(users.id, payload.sub),
  });
  if (!row) {
    logger.warn("auth.fail", { reason: "user_not_found", sub: payload.sub, ...reqMeta(req) });
    throw new HttpError(401, "User not found");
  }
  if (!row.approved) {
    logger.warn("auth.fail", { reason: "not_approved", uid: row.id, ...reqMeta(req) });
    throw new HttpError(403, "Your account is awaiting admin approval.");
  }

  logger.info("auth.ok", { uid: row.id, email: row.email, isAdmin: row.isAdmin, ...reqMeta(req) });

  return {
    id: row.id,
    uid: row.id,
    name: row.name || row.email || "Someone",
    email: row.email,
    isAdmin: row.isAdmin,
  };
}

// requireUser + admin-only gate.
export async function requireAdmin(req: Request): Promise<AuthedUser> {
  const user = await requireUser(req);
  if (!user.isAdmin) {
    logger.warn("admin.denied", { uid: user.id, isAdmin: user.isAdmin, ...reqMeta(req) });
    throw new HttpError(403, "Admins only");
  }
  return user;
}