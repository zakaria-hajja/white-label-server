import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, getContainer, setContainer } from "@/core/container";
import { TenantAdminService } from "@/core/tenant/tenant-admin.service";
import { GET } from "@/app/api/v1/app/config/route";

const config = loadConfig(process.env);
const noParams = { params: Promise.resolve({}) };
const call = (client?: string) =>
  GET(
    new Request("http://localhost/api/v1/app/config", {
      headers: client ? { "x-client-id": client } : {},
    }),
    noParams,
  );
const docFor = (name: string) => ({
  app: { displayName: name, latestVersionCode: 7 },
  support: { email: "help@example.com" },
  legal: { privacyPolicyUrl: "https://example.com/p", termsUrl: "https://example.com/t" },
  passwordReset: { linkBaseUrl: "https://example.com/reset-password" },
  runtime: { defaultLanguage: "en", supportedLanguages: ["en"], defaultTheme: "SYSTEM" },
});

let admin: TenantAdminService;
beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  admin = new TenantAdminService(testPrisma());
  await admin.create({ slug: "acme", name: "Acme" });
  await admin.create({ slug: "globex", name: "Globex" });
  await admin.setConfig("acme", docFor("Acme App"));
  await admin.setConfig("globex", docFor("Globex App"));
  await admin.setFeature("globex", "beta", true);
  await admin.setFeature("globex", "catalog", false);
});

describe("GET /app/config (shared)", () => {
  it("returns each tenant's own config", async () => {
    const a = await envelope(await call("acme"));
    const g = await envelope(await call("globex"));
    expect(a.data).toMatchObject({
      tenant: { slug: "acme", name: "Acme" },
      app: { displayName: "Acme App", latestVersionCode: 7 },
      features: { catalog: true },
    });
    expect(g.data).toMatchObject({
      app: { displayName: "Globex App" },
      features: { catalog: false, beta: true },
    });
  });

  it("sets cache and vary headers", async () => {
    const res = await call("acme");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("vary")).toBe("X-Client-Id");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("never leaks internal fields or secrets", async () => {
    const text = JSON.stringify(await envelope(await call("acme")));
    const secrets = [
      "passwordReset",
      "linkBaseUrl",
      "reset-password",
      process.env.JWT_SECRET as string,
      process.env.DATABASE_URL as string,
    ];
    for (const s of secrets) {
      expect(s).toBeTruthy();
      expect(text).not.toContain(s);
    }
  });

  it("omits unknown stored properties", async () => {
    const row = await testPrisma().applicationConfiguration.findFirstOrThrow({
      where: { tenant: { slug: "acme" } },
    });
    const stored = row.configuration as Record<string, unknown>;
    await testPrisma().applicationConfiguration.update({
      where: { id: row.id },
      data: { configuration: { ...stored, secretApiKey: "sk-123" } },
    });
    const text = JSON.stringify(await envelope(await call("acme")));
    expect(text).not.toContain("secretApiKey");
    expect(text).not.toContain("sk-123");
  });

  it("reflects a toggled flag after invalidate()", async () => {
    expect(
      ((await envelope(await call("acme"))).data as never as { features: object }).features,
    ).toEqual({ catalog: true, profile: true });
    await admin.setFeature("acme", "catalog", false);
    getContainer().featureFlags.invalidate();
    const after = await envelope(await call("acme"));
    expect(after.data).toMatchObject({ features: { catalog: false } });
  });

  it("returns 400 INVALID_CLIENT without a header", async () => {
    const res = await call();
    expect(res.status).toBe(400);
    expect((await envelope(res)).error?.code).toBe("INVALID_CLIENT");
  });

  it("returns 500 INTERNAL_ERROR when the config row is missing", async () => {
    await testPrisma().applicationConfiguration.deleteMany({});
    getContainer().appConfigReader.invalidate();
    const res = await call("acme");
    expect(res.status).toBe(500);
    expect((await envelope(res)).error?.code).toBe("INTERNAL_ERROR");
  });
});
