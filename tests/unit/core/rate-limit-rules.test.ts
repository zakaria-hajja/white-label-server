import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import type { PrismaClient } from "@/core/database/prisma";
import { route } from "@/core/http/route";
import { createLogger } from "@/core/logging/logger";
import {
  InMemoryRateLimiter,
  type RateLimiter,
  type RateLimitRule,
} from "@/core/rate-limit/rate-limiter";
import {
  forgotPasswordRateLimit,
  loginRateLimit,
  refreshRateLimit,
  registerRateLimit,
  resetPasswordRateLimit,
} from "@/modules/auth/auth.handlers";
import { changePasswordRateLimit, deleteAccountRateLimit } from "@/modules/users/users.handlers";

const config = loadConfig({
  DEPLOYMENT_MODE: "shared",
  DATABASE_URL: "postgresql://x:y@localhost:5432/none",
  JWT_SECRET: "test-jwt-secret-test-jwt-secret-0123456789",
  TRUST_PROXY: "true",
  LOG_LEVEL: "silent",
});
const tenant = { tenantId: "t1", slug: "acme", name: "Acme", source: "header" } as const;
const ctx = { params: Promise.resolve({}) };

afterEach(() => setContainer(null));

function install(rateLimiter: RateLimiter) {
  setContainer(
    createContainer(config, {
      prisma: {} as PrismaClient,
      logger: createLogger("silent"),
      rateLimiter,
      tenantResolver: { resolve: async () => tenant, verifyStartup: async () => {} },
    }),
  );
}

const req = (email: string, ip = "203.0.113.7") =>
  new Request("http://localhost/api/v1/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
    headers: { "content-type": "application/json", "x-client-id": "acme", "x-forwarded-for": ip },
  });

const forgot = route({
  auth: "none",
  tenant: "required",
  body: z.object({ email: z.string() }),
  rateLimit: forgotPasswordRateLimit,
  handler: async () => Response.json({}),
});

/** An IP rule is skipped when the IP is unknown and keyed when it is known. */
const isIpRule = (r: RateLimitRule) => {
  const c = {
    body: { email: "a@b.co" },
    tenant,
    auth: { userId: "u", tenantId: "t1", sessionId: "s" },
  };
  return r.key({ ...c, ip: "unknown" }) === null && r.key({ ...c, ip: "1.2.3.4" }) !== null;
};

describe("rate-limit rules", () => {
  it.each([
    ["register", registerRateLimit],
    ["login", loginRateLimit],
    ["refresh", refreshRateLimit],
    ["forgot-password", forgotPasswordRateLimit],
    ["reset-password", resetPasswordRateLimit],
    ["change-password", changePasswordRateLimit],
  ])("%s evaluates IP rules before any other rule", (_name, rules) => {
    const flags = rules.map(isIpRule);
    const firstOther = flags.indexOf(false);
    if (firstOther !== -1) expect(flags.slice(firstOther)).not.toContain(true);
  });

  it("change-password and delete-account share one password-guess budget per account", () => {
    // Both routes check the password; separate buckets would give an attacker 5 + 5 guesses.
    const c = {
      ip: "1.2.3.4",
      body: {},
      tenant,
      auth: { userId: "u", tenantId: "t1", sessionId: "s" },
    };
    const buckets = (rules: RateLimitRule[]) =>
      rules.map((r) => ({
        bucket: `${r.name}:${r.key(c)}`,
        limit: r.limit,
        window: r.windowSeconds,
      }));
    expect(buckets(deleteAccountRateLimit)).toEqual(buckets(changePasswordRateLimit));
  });

  it("route() stops at the first rejected rule", async () => {
    const hits: string[] = [];
    install({
      hit: (key) => (hits.push(key), { allowed: !key.startsWith("first:"), retryAfterSeconds: 5 }),
    });
    const h = route({
      auth: "none",
      tenant: "none",
      rateLimit: [
        { name: "first", limit: 1, windowSeconds: 60, key: () => "a" },
        { name: "second", limit: 1, windowSeconds: 60, key: () => "b" },
      ],
      handler: async () => Response.json({}),
    });
    const res = await h(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(429);
    expect(hits).toEqual(["first:a"]);
  });

  it("a blocked IP no longer creates forgot-password account buckets", async () => {
    const limiter = new InMemoryRateLimiter({ now: () => new Date(0) });
    const size = () => (limiter as unknown as { buckets: Map<string, unknown> }).buckets.size;
    install(limiter);
    for (let i = 0; i < 10; i++) expect((await forgot(req(`u${i}@x.co`), ctx)).status).toBe(200);
    const before = size();
    for (let i = 10; i < 50; i++) expect((await forgot(req(`u${i}@x.co`), ctx)).status).toBe(429);
    expect(size()).toBe(before);
  });
});
