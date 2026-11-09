import type { Clock } from "../../shared/clock";
import type { AuthContext } from "../auth/auth-context";
import type { TenantContext } from "../tenant/tenant-context";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): RateLimitResult;
}

export type RateLimitRule = {
  name: string;
  limit: number;
  windowSeconds: number;
  /** Return null to skip the rule. */
  key: (c: {
    ip: string;
    body: unknown;
    tenant: TenantContext | null;
    auth: AuthContext | null;
  }) => string | null;
};

/**
 * Builds an IP-based rule key. Rule authors MUST use this for IP keys: it returns null when the
 * client IP is unknown (no trusted proxy), so the rule is skipped instead of putting every client
 * into one shared bucket.
 */
export function ipKey(ip: string, ...parts: string[]): string | null {
  if (ip === "unknown") return null;
  return [ip, ...parts].join(":");
}

const SWEEP_EVERY = 500;

/** Fixed-window limiter, single process. No timers: expired keys go on access and via a periodic sweep. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private calls = 0;

  constructor(private readonly clock: Clock) {}

  hit(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = this.clock.now().getTime();
    if (++this.calls % SWEEP_EVERY === 0) this.sweep(now);
    let bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }
    bucket.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private sweep(now: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}
