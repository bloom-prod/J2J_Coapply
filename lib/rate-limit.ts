// Lightweight in-memory rate limiter + client-IP helper for auth endpoints.
//
// Single-instance store (module-level Map) — right shape for this deployment
// (one Next.js process), no extra infra. If ever scaled horizontally, move
// counters to Redis.

interface Entry {
  count: number;
  windowStart: number;
}

class InMemoryRateLimiter {
  private store = new Map<string, Entry>();
  private readonly maxEntries = 100_000;

  // Increment the counter for `key` within a `windowMs` sliding-lookback step
  // and return whether the request is still allowed (count <= max).
  hit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      this.store.set(key, { count: 1, windowStart: now });
      this.evict();
      return 1 <= max;
    }
    entry.count += 1;
    return entry.count <= max;
  }

  clear(key: string): void {
    this.store.delete(key);
  }

  private evict(): void {
    if (this.store.size <= this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.windowStart > 60 * 60 * 1000) this.store.delete(key);
    }
  }
}

export const rateLimiter = new InMemoryRateLimiter();

// Best-effort client IP from the standard forwarding headers.
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Coarse per-IP / per-key budgets for the unauthenticated auth endpoints.
export const IP_LIMITS = {
  login: 30, // 30 attempts / 15 min per IP
  forgot: 10, // 10 reset requests / 15 min per IP (limits email bombing)
  signup: 10,
  resetAttempts: 5, // 5 wrong OTP guesses / 15 min per (email, IP)
  forgotPerEmail: 3, // 3 resets / 15 min per address (stop OTP inbox flood)
  feedback: 10, // 10 feedback emails / 15 min per user or IP
} as const;