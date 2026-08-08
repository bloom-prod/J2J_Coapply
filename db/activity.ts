import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { inArray } from "drizzle-orm";
import { activityLog, users } from "./schema";

export type DBLike = PostgresJsDatabase<Record<string, never>> | PgTransaction<any, any, any>;

export type ActivityType =
  | "APPLIED"
  | "STATUS"
  | "OFFER"
  | "JOB_SHARE"
  | "RESUME_UPLOAD"
  | "RESUME_DELETE"
  | "LC_SOLVED";

export type ActivityInput = {
  userId: string;
  type: ActivityType;
  company?: string | null;
  role?: string | null;
  status?: string | null;
  resumeId?: string | null;
  problemId?: string | null;
  occuredAt?: Date;
};

/**
 * Append a row to activity_log. Pass a transaction handle to keep it atomic
 * with the mutation that caused it; otherwise it's a standalone insert.
 */
export async function logActivity(tx: DBLike, input: ActivityInput) {
  const now = input.occuredAt ?? new Date();
  await tx.insert(activityLog).values({
    userId: input.userId,
    type: input.type,
    company: input.company ?? null,
    role: input.role ?? null,
    status: input.status ?? null,
    resumeId: input.resumeId ?? null,
    problemId: input.problemId ?? null,
    occuredAt: now,
  });
}

/**
 * Resolve userId -> display name. Used to denormalize owner/creator names
 * the way Firestore's userProfiles join did.
 */
const nameCache = new Map<string, string>();
export async function namesByIds(db: PostgresJsDatabase<any> | PgTransaction<any, any, any>, ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const missing = uniq.filter((id) => !nameCache.has(id));
  if (missing.length) {
    const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, missing));
    for (const r of rows) nameCache.set(r.id, r.name || "");
  }
  const out: Record<string, string> = {};
  for (const id of uniq) {
    const n = nameCache.get(id);
    out[id] = n || "";
  }
  return out;
}

/**
 * Drop a cached name so it's re-read on the next request — call this whenever a
 * user renames, otherwise server-rendered owner/creator names go stale until
 * the process restarts.
 */
export function invalidateName(id: string): void {
  if (id) nameCache.delete(id);
}

/**
 * Drop all cached names (e.g. after a bulk rename/migration).
 */
export function clearNameCache(): void {
  nameCache.clear();
}