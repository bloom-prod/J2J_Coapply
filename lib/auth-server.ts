import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyToken } from "./jwt";

export interface AuthedUser {
  id: string; // postgres uuid
  uid: string; // alias of id, kept for a drop-in swap during migration
  name: string;
  email: string;
  isAdmin: boolean;
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
  if (!match) throw new HttpError(401, "Missing Authorization bearer token");

  let payload: { sub: string } | undefined;
  try {
    payload = await verifyToken(match[1]);
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }

  const row = await db.query.users.findFirst({
    where: eq(users.id, payload.sub),
  });
  if (!row) throw new HttpError(401, "User not found");
  if (!row.approved) {
    throw new HttpError(403, "Your account is awaiting admin approval.");
  }

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
  if (!user.isAdmin) throw new HttpError(403, "Admins only");
  return user;
}