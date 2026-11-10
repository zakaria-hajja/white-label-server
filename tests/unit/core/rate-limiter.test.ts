import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, ipKey } from "@/core/rate-limit/rate-limiter";

function setup() {
  let t = new Date("2026-01-01T00:00:00Z").getTime();
  const limiter = new InMemoryRateLimiter({ now: () => new Date(t) });
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe("InMemoryRateLimiter", () => {
  it("allows 5 hits, blocks the 6th with retryAfter > 0, resets after the window", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) expect(limiter.hit("k", 5, 60).allowed).toBe(true);
    const blocked = limiter.hit("k", 5, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    advance(30_000);
    expect(limiter.hit("k", 5, 60).retryAfterSeconds).toBe(30);
    advance(30_000);
    expect(limiter.hit("k", 5, 60).allowed).toBe(true);
  });

  it("keeps keys independent", () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.hit("a", 5, 60);
    expect(limiter.hit("a", 5, 60).allowed).toBe(false);
    expect(limiter.hit("b", 5, 60).allowed).toBe(true);
  });

  it("sweeps expired keys periodically", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 100; i++) limiter.hit(`old${i}`, 1, 1);
    advance(5000);
    for (let i = 0; i < 500; i++) limiter.hit("live", 1000, 60);
    expect((limiter as unknown as { buckets: Map<string, unknown> }).buckets.size).toBe(1);
  });
});

describe("ipKey", () => {
  it("returns null for an unknown ip, joins parts otherwise", () => {
    expect(ipKey("unknown", "x")).toBeNull();
    expect(ipKey("1.2.3.4", "a@b.co")).toBe("1.2.3.4:a@b.co");
  });
});

describe("InMemoryRateLimiter entry cap", () => {
  const size = (l: InMemoryRateLimiter) =>
    (l as unknown as { buckets: Map<string, unknown> }).buckets.size;

  it("defaults to 100_000 entries", () => {
    const { limiter } = setup();
    expect((limiter as unknown as { maxEntries: number }).maxEntries).toBe(100_000);
  });

  it("never holds more than maxEntries, evicting the oldest live key", () => {
    const limiter = new InMemoryRateLimiter({ now: () => new Date(0) }, { maxEntries: 3 });
    for (const k of ["a", "b", "c", "d"]) limiter.hit(k, 1, 60);
    expect(size(limiter)).toBe(3);
    // "a" was evicted, so it starts a fresh bucket; "d" is still counted.
    expect(limiter.hit("d", 1, 60).allowed).toBe(false);
    expect(limiter.hit("a", 1, 60).allowed).toBe(true);
    expect(size(limiter)).toBe(3);
  });

  it("evicts expired entries before live ones", () => {
    let t = 0;
    const limiter = new InMemoryRateLimiter({ now: () => new Date(t) }, { maxEntries: 3 });
    limiter.hit("live1", 1, 60);
    limiter.hit("short", 1, 1);
    limiter.hit("live2", 1, 60);
    t += 2000;
    limiter.hit("new", 1, 60);
    expect(size(limiter)).toBe(3);
    // Both long-lived keys survived: their buckets are still exhausted.
    expect(limiter.hit("live1", 1, 60).allowed).toBe(false);
    expect(limiter.hit("live2", 1, 60).allowed).toBe(false);
  });

  it("rejects a non-positive cap", () => {
    expect(() => new InMemoryRateLimiter({ now: () => new Date() }, { maxEntries: 0 })).toThrow();
  });
});
