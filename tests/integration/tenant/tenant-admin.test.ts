import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { TenantAdminService, defaultAppConfig } from "@/core/tenant/tenant-admin.service";
import { seed } from "../../../prisma/seed-data";
import { testPrisma } from "../../helpers/db";

const service = () => new TenantAdminService(testPrisma());

describe("TenantAdminService", () => {
  it("create writes a default config and flags", async () => {
    const t = await service().create({ slug: "acme", name: "Acme" });
    expect(t).toMatchObject({ slug: "acme", name: "Acme", status: "ACTIVE" });
    const cfg = await testPrisma().applicationConfiguration.findUniqueOrThrow({
      where: { tenantId: t.id },
    });
    expect(cfg.version).toBe(1);
    expect(cfg.configuration).toMatchObject({
      app: { displayName: "Acme" },
      passwordReset: { linkBaseUrl: "https://example.com/reset-password" },
    });
    const flags = await testPrisma().featureFlag.findMany({ where: { tenantId: t.id } });
    const byKey = Object.fromEntries(flags.map((f) => [f.key, f.enabled]));
    expect(byKey).toEqual({ catalog: true, profile: true });
  });

  it("create with a duplicate slug names the slug", async () => {
    await service().create({ slug: "acme", name: "Acme" });
    await expect(service().create({ slug: "acme", name: "Other" })).rejects.toThrow(/acme/);
    expect(await testPrisma().tenant.count()).toBe(1);
  });

  it("create rejects an invalid slug", async () => {
    await expect(service().create({ slug: "Bad Slug", name: "x" })).rejects.toThrow(/slug/i);
  });

  it("setConfig validates, leaves the DB unchanged on failure, and bumps version", async () => {
    const t = await service().create({ slug: "acme", name: "Acme" });
    const before = await testPrisma().applicationConfiguration.findUniqueOrThrow({
      where: { tenantId: t.id },
    });
    const bad = {
      ...(before.configuration as object),
      legal: { privacyPolicyUrl: "nope", termsUrl: "https://a.test/t" },
    };
    await expect(service().setConfig("acme", bad)).rejects.toBeInstanceOf(ZodError);
    const same = await testPrisma().applicationConfiguration.findUniqueOrThrow({
      where: { tenantId: t.id },
    });
    expect(same.version).toBe(1);
    expect(same.configuration).toEqual(before.configuration);

    const good = { ...(before.configuration as object), app: { displayName: "New" } };
    await service().setConfig("acme", good);
    const after = await testPrisma().applicationConfiguration.findUniqueOrThrow({
      where: { tenantId: t.id },
    });
    expect(after.version).toBe(2);
    expect(after.configuration).toMatchObject({ app: { displayName: "New" } });
  });

  it("setFeature upserts", async () => {
    const t = await service().create({ slug: "acme", name: "Acme" });
    await service().setFeature("acme", "beta", true);
    await service().setFeature("acme", "beta", false);
    const rows = await testPrisma().featureFlag.findMany({
      where: { tenantId: t.id, key: "beta" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
  });

  it("setStatus updates, calls onChange, and unknown slug names the slug", async () => {
    let calls = 0;
    const s = new TenantAdminService(testPrisma(), () => void calls++);
    await s.create({ slug: "acme", name: "Acme" });
    const r = await s.setStatus("acme", "SUSPENDED");
    expect(r.status).toBe("SUSPENDED");
    expect(calls).toBeGreaterThan(0);
    await expect(s.setStatus("ghost", "ACTIVE")).rejects.toThrow(/ghost/);
    await expect(s.setConfig("ghost", {})).rejects.toThrow(/ghost/);
    await expect(s.setFeature("ghost", "x", true)).rejects.toThrow(/ghost/);
  });

  it("list returns all tenants", async () => {
    await service().create({ slug: "acme", name: "Acme" });
    await service().create({ slug: "globex", name: "Globex" });
    expect((await service().list()).map((t) => t.slug)).toEqual(["acme", "globex"]);
  });
});

describe("seed", () => {
  const cfg = { mode: "shared" as const, dedicatedTenantSlug: null, nodeEnv: "test" };

  it("is idempotent in shared mode", async () => {
    await seed(testPrisma(), cfg);
    await seed(testPrisma(), cfg);
    const p = testPrisma();
    expect(await p.tenant.count()).toBe(2);
    expect(await p.user.count()).toBe(4);
    expect(await p.catalogItem.count()).toBe(50);
    expect(await p.featureFlag.count()).toBe(4);
    for (const slug of ["acme", "globex"]) {
      const flags = await p.featureFlag.findMany({ where: { tenant: { slug } } });
      expect(Object.fromEntries(flags.map((f) => [f.key, f.enabled]))).toEqual({
        catalog: true,
        profile: true,
      });
    }
  });

  it("adds missing starter flags to a tenant seeded earlier, without flipping existing ones", async () => {
    const p = testPrisma();
    const acme = await p.tenant.create({ data: { slug: "acme", name: "Acme" } });
    await p.applicationConfiguration.create({
      data: { tenantId: acme.id, configuration: defaultAppConfig("Acme") },
    });
    await p.featureFlag.create({ data: { tenantId: acme.id, key: "catalog", enabled: false } });
    await seed(p, cfg);
    const flags = await p.featureFlag.findMany({ where: { tenantId: acme.id } });
    expect(Object.fromEntries(flags.map((f) => [f.key, f.enabled]))).toEqual({
      catalog: false,
      profile: true,
    });
    expect(await p.featureFlag.count()).toBe(4);
    expect(await p.tenant.count()).toBe(2);
    expect(await p.applicationConfiguration.count()).toBe(2);
  });

  it("refuses in production", async () => {
    await expect(seed(testPrisma(), { ...cfg, nodeEnv: "production" })).rejects.toThrow(
      /production/,
    );
    expect(await testPrisma().tenant.count()).toBe(0);
  });
});
