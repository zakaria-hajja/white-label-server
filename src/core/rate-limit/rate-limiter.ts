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
const FULL_SWEEP_MIN_INTERVAL_MS = 1000;

export type InMemoryRateLimiterOptions = {
  /** Hard cap on stored keys (default 100_000). Bounds memory when keys are attacker-chosen. */
  maxEntries?: number;
};

/**
 * Fixed-window limiter, single process. No timers: expired keys go on access and via a periodic
 * sweep. At most `maxEntries` keys are kept: when a new key would exceed it, expired keys are
 * dropped first, then the oldest keys (Map insertion order). Evicting a live key only resets that
 * key's count, so the cap trades a little precision under a flood for bounded memory.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly maxEntries: number;
  private calls = 0;
  private lastFullSweepAt = -Infinity;

  constructor(
    private readonly clock: Clock,
    options: InMemoryRateLimiterOptions = {},
  ) {
    const max = options.maxEntries ?? 100_000;
    if (!Number.isInteger(max) || max < 1) throw new Error("maxEntries must be a positive integer");
    this.maxEntries = max;
  }

  hit(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = this.clock.now().getTime();
    if (++this.calls % SWEEP_EVERY === 0) this.sweep(now);
    let bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      this.makeRoom(now);
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

  /** Frees one slot for a new key. Full sweeps at the cap are throttled so a flood stays O(1). */
  private makeRoom(now: number): void {
    if (this.buckets.size < this.maxEntries) return;
    if (now - this.lastFullSweepAt >= FULL_SWEEP_MIN_INTERVAL_MS) {
      this.lastFullSweepAt = now;
      this.sweep(now);
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldest = this.buckets.keys().next().value as string;
      this.buckets.delete(oldest);
    }
  }

  private sweep(now: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}
