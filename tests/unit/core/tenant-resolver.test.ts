import { describe, expect, it } from "vitest";
import { loadConfig } from "@/core/config/env";
import { AppError } from "@/core/errors/app-error";
import { CachedTenantLookup } from "@/core/tenant/tenant-cache";
import { DedicatedTenantResolver } from "@/core/tenant/dedicated-resolver";
import { SharedTenantResolver } from "@/core/tenant/shared-resolver";
import type { TenantLookup, TenantRecord } from "@/core/tenant/tenant-context";
import type { Clock } from "@/shared/clock";

const acme: TenantRecord = { id: "t-acme", slug: "acme", name: "Acme", status: "ACTIVE" };
const globex: TenantRecord = { id: "t-globex", slug: "globex", name: "Globex", status: "ACTIVE" };
const sleepy: TenantRecord = {
  id: "t-sleepy",
  slug: "sleepy",
  name: "Sleepy",
  status: "SUSPENDED",
};

function fakeLookup(records: TenantRecord[]): TenantLookup & { calls: number } {
  const lookup = {
    calls: 0,
    async findBySlug(slug: string) {
      lookup.calls++;
      return records.find((r) => r.slug === slug) ?? null;
    },
    async findById(id: string) {
      lookup.calls++;
      return records.find((r) => r.id === id) ?? null;
    },
  };
  return lookup;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "OK";
}

describe("SharedTenantResolver", () => {
  const r = new SharedTenantResolver(fakeLookup([acme, globex, sleepy]));
  const none = { clientId: null, tokenTenantId: null };

  it("no token, no header -> INVALID_CLIENT", async () => {
    expect(await codeOf(r.resolve(none))).toBe("INVALID_CLIENT");
  });
  it("no token, unknown or malformed header -> INVALID_CLIENT", async () => {
    expect(await codeOf(r.resolve({ ...none, clientId: "nope" }))).toBe("INVALID_CLIENT");
    expect(await codeOf(r.resolve({ ...none, clientId: "Bad_Slug!" }))).toBe("INVALID_CLIENT");
  });
  it("no token, known header -> header source", async () => {
    expect(await r.resolve({ ...none, clientId: "acme" })).toEqual({
      tenantId: "t-acme",
      slug: "acme",
      name: "Acme",
      source: "header",
    });
  });
  it("token with no header or same header -> token source", async () => {
    const a = await r.resolve({ clientId: null, tokenTenantId: "t-acme" });
    const b = await r.resolve({ clientId: "acme", tokenTenantId: "t-acme" });
    expect(a.source).toBe("token");
    expect(b).toEqual(a);
  });
  it("token with a different known, unknown or malformed header -> TENANT_MISMATCH", async () => {
    for (const clientId of ["globex", "ghost", "Bad_Slug!"]) {
      expect(await codeOf(r.resolve({ clientId, tokenTenantId: "t-acme" }))).toBe(
        "TENANT_MISMATCH",
      );
    }
  });
  it("token for a vanished tenant -> UNAUTHENTICATED", async () => {
    expect(await codeOf(r.resolve({ clientId: null, tokenTenantId: "t-gone" }))).toBe(
      "UNAUTHENTICATED",
    );
  });
  it("suspended tenant -> TENANT_SUSPENDED (header and token)", async () => {
    expect(await codeOf(r.resolve({ ...none, clientId: "sleepy" }))).toBe("TENANT_SUSPENDED");
    expect(await codeOf(r.resolve({ clientId: null, tokenTenantId: "t-sleepy" }))).toBe(
      "TENANT_SUSPENDED",
    );
  });
  it("suspension is not revealed for an unknown/mismatched header", async () => {
    expect(await codeOf(r.resolve({ clientId: "acme", tokenTenantId: "t-sleepy" }))).toBe(
      "TENANT_MISMATCH",
    );
  });
});

const dedicatedConfig = (slug: string) =>
  loadConfig({
    DEPLOYMENT_MODE: "dedicated",
    DEDICATED_TENANT_SLUG: slug,
    DATABASE_URL: "postgresql://x:y@localhost:5432/none",
    JWT_SECRET: "test-jwt-secret-test-jwt-secret-0123456789",
  });

describe("DedicatedTenantResolver", () => {
  const r = new DedicatedTenantResolver(fakeLookup([acme, globex]), dedicatedConfig("acme"));

  it("no token, no header or matching header -> deployment source", async () => {
    const a = await r.resolve({ clientId: null, tokenTenantId: null });
    expect(a).toEqual({ tenantId: "t-acme", slug: "acme", name: "Acme", source: "deployment" });
    expect(await r.resolve({ clientId: "acme", tokenTenantId: null })).toEqual(a);
  });
  it("header naming another slug -> INVALID_CLIENT", async () => {
    expect(await codeOf(r.resolve({ clientId: "globex", tokenTenantId: null }))).toBe(
      "INVALID_CLIENT",
    );
    expect(await codeOf(r.resolve({ clientId: "globex", tokenTenantId: "t-acme" }))).toBe(
      "INVALID_CLIENT",
    );
  });
  it("token for another tenant -> UNAUTHENTICATED", async () => {
    expect(await codeOf(r.resolve({ clientId: null, tokenTenantId: "t-globex" }))).toBe(
      "UNAUTHENTICATED",
    );
  });
  it("matching token -> deployment source", async () => {
    expect((await r.resolve({ clientId: null, tokenTenantId: "t-acme" })).tenantId).toBe("t-acme");
  });
  it("suspended deployment tenant -> TENANT_SUSPENDED", async () => {
    const s = new DedicatedTenantResolver(fakeLookup([sleepy]), dedicatedConfig("sleepy"));
    expect(await codeOf(s.resolve({ clientId: null, tokenTenantId: null }))).toBe(
      "TENANT_SUSPENDED",
    );
  });
  it("verifyStartup passes for an active tenant", async () => {
    await expect(r.verifyStartup()).resolves.toBeUndefined();
  });
  it("verifyStartup rejects when the slug is missing", async () => {
    const m = new DedicatedTenantResolver(fakeLookup([]), dedicatedConfig("acme"));
    await expect(m.verifyStartup()).rejects.toThrow(/acme/);
  });
  it("verifyStartup rejects when the tenant is suspended", async () => {
    const s = new DedicatedTenantResolver(fakeLookup([sleepy]), dedicatedConfig("sleepy"));
    await expect(s.verifyStartup()).rejects.toThrow(/suspended/i);
  });
});

describe("CachedTenantLookup", () => {
  function setup() {
    let t = 0;
    const clock: Clock = { now: () => new Date(t) };
    const src = fakeLookup([acme]);
    return { src, cache: new CachedTenantLookup(src, clock), advance: (ms: number) => (t += ms) };
  }

  it("hits the source once within 30 s and again after 31 s", async () => {
    const { src, cache, advance } = setup();
    await cache.findBySlug("acme");
    await cache.findBySlug("acme");
    expect(src.calls).toBe(1);
    advance(31_000);
    await cache.findBySlug("acme");
    expect(src.calls).toBe(2);
  });
  it("serves findById from a record cached via findBySlug", async () => {
    const { src, cache } = setup();
    await cache.findBySlug("acme");
    expect((await cache.findById("t-acme"))?.slug).toBe("acme");
    expect(src.calls).toBe(1);
  });
  it("does not cache misses", async () => {
    const { src, cache } = setup();
    expect(await cache.findBySlug("ghost")).toBeNull();
    expect(await cache.findBySlug("ghost")).toBeNull();
    expect(src.calls).toBe(2);
  });
  it("invalidate() clears everything", async () => {
    const { src, cache } = setup();
    await cache.findBySlug("acme");
    cache.invalidate();
    await cache.findBySlug("acme");
    expect(src.calls).toBe(2);
  });
});
