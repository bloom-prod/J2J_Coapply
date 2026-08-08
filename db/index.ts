import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

let real: DB | null = null;

function getDb(): DB {
  if (real) return real;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing DATABASE_URL — set it to your Postgres connection string.");
  }
  real = drizzle(postgres(url, { max: 10 }), { schema });
  return real;
}

/**
 * Lazy Postgres handle. `next build` imports route modules without a live
 * DATABASE_URL, so we must not connect / throw at import time — the first DB
 * call (runtime) triggers the connection and the env check.
 */
export const db = new Proxy({} as DB, {
  get(_t, prop: string | symbol) {
    const target = getDb() as unknown as Record<PropertyKey, unknown>;
    const v = target[prop as PropertyKey];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});