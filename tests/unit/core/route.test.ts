import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { envelope } from "../../helpers/http";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { AppError } from "@/core/errors/app-error";
import { clientIp } from "@/core/http/client-ip";
import { route } from "@/core/http/route";
import { createLogger } from "@/core/logging/logger";
import type { PrismaClient } from "@/core/database/prisma";

const config = loadConfig({
  DEPLOYMENT_MODE: "shared",
  DATABASE_URL: "postgresql://x:y@localhost:5432/none",
  JWT_SECRET: "test-jwt-secret-test-jwt-secret-0123456789",
});

let logLines: Record<string, unknown>[];

beforeEach(() => {
  logLines = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      logLines.push(JSON.parse(String(chunk)));
      cb();
    },
  });
  setContainer(
    createContainer(config, { prisma: {} as PrismaClient, logger: createLogger("debug", dest) }),
  );
});
afterEach(() => setContainer(null));

const ctx = { params: Promise.resolve({}) };
const post = (body: string | null | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/x?secret=1", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });

const bodyRoute = route({
  auth: "none",
  tenant: "none",
  body: z.object({ email: z.email() }),
  handler: async ({ body, requestId }) => Response.json({ email: body.email, requestId }),
});

describe("route()", () => {
  it("maps AppError to its envelope", async () => {
    const h = route({
      auth: "none",
      tenant: "none",
      handler: async () => {
        throw new AppError("NOT_FOUND");
      },
    });
    const res = await h(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
    expect((await envelope(res))?.error?.code).toBe("NOT_FOUND");
  });

  it("hides unknown error details and logs the error", async () => {
    const h = route({
      auth: "none",
      tenant: "none",
      handler: async () => {
        throw new Error("db password=abc");
      },
    });
    const res = await h(new Request("http://localhost/x"), ctx);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("abc");
    expect(text).not.toContain("stack");
    expect(logLines.some((l) => l.level === 50 && l.err)).toBe(true);
  });

  it("returns 400 with dotted paths for schema failures", async () => {
    const res = await bodyRoute(post(JSON.stringify({ email: "nope" })), ctx);
    const json = await envelope(res);
    expect(res.status).toBe(400);
    expect(json.error?.code).toBe("VALIDATION_ERROR");
    expect(json.error?.details?.[0]?.path).toBe("email");
  });

  it("rejects malformed JSON, null body, wrong content type", async () => {
    for (const res of [
      await bodyRoute(post("{not json"), ctx),
      await bodyRoute(post(null), ctx),
      await bodyRoute(post("null"), ctx),
      await bodyRoute(post("{}", { "content-type": "text/plain" }), ctx),
    ]) {
      expect(res.status).toBe(400);
      expect((await envelope(res))?.error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects oversized bodies with 413", async () => {
    const big = JSON.stringify({ email: "a@b.co", pad: "x".repeat(70_000) });
    const res = await bodyRoute(post(big), ctx);
    expect(res.status).toBe(413);
    expect((await envelope(res))?.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("enforces the limit on a stream with no content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(`{"a":"${"x".repeat(70_000)}"}`));
        c.close();
      },
    });
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: stream,
      headers: { "content-type": "application/json" },
      duplex: "half",
    });
    expect((await bodyRoute(req, ctx)).status).toBe(413);
  });

  it("parses query and params", async () => {
    const h = route({
      auth: "none",
      tenant: "none",
      query: z.object({ n: z.coerce.number() }),
      params: z.object({ id: z.string() }),
      handler: async ({ query, params }) => Response.json({ n: query.n, id: params.id }),
    });
    const res = await h(new Request("http://localhost/x?n=5"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(await envelope(res)).toEqual({ n: 5, id: "abc" });
  });

  it("echoes a valid X-Request-Id and replaces an unsafe one", async () => {
    const res1 = await bodyRoute(
      post(JSON.stringify({ email: "a@b.co" }), { "x-request-id": "abcdef12" }),
      ctx,
    );
    expect(res1.headers.get("x-request-id")).toBe("abcdef12");
    const res2 = await bodyRoute(
      post(JSON.stringify({ email: "a@b.co" }), { "x-request-id": "<script>" }),
      ctx,
    );
    expect(res2.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("logs flat fields only, without query string or body", async () => {
    await bodyRoute(post(JSON.stringify({ email: "a@b.co" })), ctx);
    const line = logLines.find((l) => l.msg === "request");
    expect(line).toMatchObject({ method: "POST", path: "/api/v1/x", status: 200 });
    expect(typeof line?.durationMs).toBe("number");
    expect(JSON.stringify(logLines)).not.toContain("secret=1");
    expect(JSON.stringify(logLines)).not.toContain("a@b.co");
  });

  it('refuses auth "required" without tenant "required" at definition time', () => {
    const handler = async () => new Response();
    expect(() => route({ auth: "required", tenant: "none", handler })).toThrow(/tenant "required"/);
  });

  it("returns an envelope 500 with a request id when the container cannot be built", async () => {
    setContainer(null);
    const saved = { ...process.env };
    delete process.env.DEPLOYMENT_MODE;
    try {
      const h = route({ auth: "none", tenant: "none", handler: async () => new Response() });
      const res = await h(post(null), ctx);
      expect(res.status).toBe(500);
      expect(res.headers.get("x-request-id")).toBeTruthy();
      const json = await envelope(res);
      expect(json.error).toMatchObject({ code: "INTERNAL_ERROR" });
    } finally {
      process.env = saved;
    }
  });

  it("resolves the tenant before validating the body", async () => {
    const mk = (status: "ACTIVE" | "SUSPENDED" | "NONE") =>
      setContainer(
        createContainer(config, {
          prisma: {} as PrismaClient,
          logger: createLogger("silent"),
          tenantResolver: {
            resolve: async () => {
              if (status === "NONE") throw new AppError("INVALID_CLIENT", "Unknown client");
              if (status === "SUSPENDED") throw new AppError("TENANT_SUSPENDED", "suspended");
              return { tenantId: "t1", slug: "acme", name: "Acme", source: "header" };
            },
            verifyStartup: async () => {},
          },
        }),
      );
    const h = route({
      auth: "none",
      tenant: "required",
      body: z.object({ email: z.email() }),
      handler: async () => Response.json({}),
    });
    const bad = () => post(JSON.stringify({ email: "nope" }));
    mk("NONE");
    const r1 = await h(bad(), ctx);
    expect(r1.status).toBe(400);
    expect((await envelope(r1)).error).toMatchObject({ code: "INVALID_CLIENT" });
    mk("SUSPENDED");
    const r2 = await h(bad(), ctx);
    expect(r2.status).toBe(403);
    expect((await envelope(r2)).error).toMatchObject({ code: "TENANT_SUSPENDED" });
    mk("ACTIVE");
    expect((await envelope(await h(bad(), ctx))).error).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("resolves the tenant only for tenant: required routes and logs its slug", async () => {
    const calls: unknown[] = [];
    const record = { tenantId: "t1", slug: "acme", name: "Acme", source: "header" } as const;
    setContainer(
      createContainer(config, {
        prisma: {} as PrismaClient,
        logger: createLogger(
          "debug",
          new Writable({
            write(chunk, _e, cb) {
              logLines.push(JSON.parse(String(chunk)));
              cb();
            },
          }),
        ),
        tenantResolver: {
          resolve: async (i) => (calls.push(i), record),
          verifyStartup: async () => {},
        },
      }),
    );
    const req = () => post(null, { "x-client-id": "acme" });
    const needs = route({
      auth: "none",
      tenant: "required",
      handler: async ({ tenant }) => Response.json({ slug: tenant.slug }),
    });
    const skips = route({
      auth: "none",
      tenant: "none",
      handler: async ({ tenant }) => Response.json({ tenant }),
    });
    expect(await (await needs(req(), ctx)).json()).toEqual({ slug: "acme" });
    expect(calls).toEqual([{ clientId: "acme", tokenTenantId: null }]);
    expect(await (await skips(req(), ctx)).json()).toEqual({ tenant: null });
    expect(calls).toHaveLength(1);
    expect(logLines.find((l) => l.msg === "request")).toMatchObject({ tenant: "acme" });
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });
  const xff = (v: string) => req({ "x-forwarded-for": v });

  it("ignores X-Forwarded-For and X-Real-IP when trustProxy is false", () => {
    expect(clientIp(xff("1.2.3.4, 5.6.7.8"), false, 1)).toBe("unknown");
    expect(clientIp(req({ "x-real-ip": "1.2.3.4" }), false, 1)).toBe("unknown");
  });

  it("uses the entry appended by the single trusted proxy (rightmost) by default", () => {
    expect(clientIp(xff("1.2.3.4, 5.6.7.8"), true, 1)).toBe("5.6.7.8");
    expect(clientIp(xff("5.6.7.8"), true, 1)).toBe("5.6.7.8");
  });

  it("ignores spoofed leftmost entries the client sent itself", () => {
    // The client sent "X-Forwarded-For: 9.9.9.9, 8.8.8.8"; our proxy appended the real 5.6.7.8.
    expect(clientIp(xff("9.9.9.9, 8.8.8.8, 5.6.7.8"), true, 1)).toBe("5.6.7.8");
  });

  it("with hops=2 takes the second entry from the right", () => {
    // client -> CDN (appends client ip) -> load balancer (appends CDN ip) -> app
    expect(clientIp(xff("9.9.9.9, 5.6.7.8, 10.0.0.1"), true, 2)).toBe("5.6.7.8");
    expect(clientIp(xff("5.6.7.8, 10.0.0.1"), true, 2)).toBe("5.6.7.8");
  });

  it("is unknown when there are fewer entries than hops or the entry is not an IP", () => {
    expect(clientIp(xff("10.0.0.1"), true, 2)).toBe("unknown");
    expect(clientIp(xff("1.2.3.4, not-an-ip"), true, 1)).toBe("unknown");
  });

  it("uses X-Real-IP only when X-Forwarded-For is absent", () => {
    expect(clientIp(req({ "x-real-ip": "1.2.3.4" }), true, 1)).toBe("1.2.3.4");
    expect(clientIp(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "bogus" }), true, 1)).toBe(
      "unknown",
    );
    expect(clientIp(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }), true, 1)).toBe(
      "5.6.7.8",
    );
  });
});
