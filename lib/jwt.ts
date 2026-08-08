import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

// Resolve the signing secret lazily so `next build` works without JWT_SECRET;
// it's only required at runtime when a token is actually signed/verified.
function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET — set a long random string.");
  return new TextEncoder().encode(s);
}

export interface JwtPayload {
  sub: string; // user id (postgres uuid)
  email?: string;
  isAdmin?: boolean;
}

export interface TokenUser {
  id: string;
  email?: string;
  isAdmin?: boolean;
}

const ISS = "bloom-tracker";
const AUD = "bloom-tracker";

export async function signToken(user: TokenUser): Promise<string> {
  return new SignJWT({ email: user.email, isAdmin: user.isAdmin })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISS,
    audience: AUD,
  });
  if (!payload.sub) throw new Error("Token missing subject");
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    isAdmin: Boolean(payload.isAdmin),
  };
}

// ── bcrypt password helpers ──────────────────────────────────────────────
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}