import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { TenantAdminService } from "@/core/tenant/tenant-admin.service";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/v1/settings/route";

const config = loadConfig(process.env);
const PASSWORD = "correct-horse-1";
const noParams = { params: Promise.resolve({}) };

const req = (method: string, body?: unknown, opts: { tenant?: string; token?: string } = {}) =>
  new Request("http://localhost/api/v1/settings", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      "x-client-id": opts.tenant ?? "acme",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
  });

async function signup(email: string, tenant = "acme"): Promise<string> {
  const res = await register(req("POST", { email, password: PASSWORD }, { tenant }), noParams);
  return ((await envelope(res)).data?.tokens as { accessToken: string }).accessToken;
}
const get = (token: string, tenant = "acme") =>
  getSettings(req("GET", undefined, { token, tenant }), noParams);
const patch = (token: string, body: unknown) =>
  patchSettings(req("PATCH", body, { token }), noParams);

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  const admin = new TenantAdminService(testPrisma());
  const acme = await admin.create({ slug: "acme", name: "Acme" });
  await admin.create({ slug: "globex", name: "Globex" });
  const row = await testPrisma().applicationConfiguration.findUniqueOrThrow({
    where: { tenantId: acme.id },
  });
  const doc = row.configuration as { runtime: Record<string, unknown> };
  doc.runtime = { defaultLanguage: "fr", supportedLanguages: ["en", "fr"], defaultTheme: "DARK" };
  await testPrisma().applicationConfiguration.update({
    where: { tenantId: acme.id },
    data: { configuration: doc as object },
  });
});

const defaults = {
  theme: "DARK",
  language: "fr",
  notifications: { push: true, email: true, marketing: false },
};

describe("GET/PATCH /settings", () => {
  it("requires a token", async () => {
    expect((await getSettings(req("GET"), noParams)).status).toBe(401);
  });

  it("GET on a fresh user returns tenant defaults and writes no row", async () => {
    const t = await signup("a@x.co");
    const res = await get(t);
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toEqual(defaults);
    expect(await testPrisma().userSettings.count()).toBe(0);
  });

  it("PATCH theme changes only theme", async () => {
    const t = await signup("a@x.co");
    const res = await patch(t, { theme: "LIGHT" });
    expect(res.status).toBe(200);
    expect((await envelope(await get(t))).data).toEqual({ ...defaults, theme: "LIGHT" });
  });

  it("PATCH notifications merges shallowly", async () => {
    const t = await signup("a@x.co");
    await patch(t, { notifications: { marketing: true } });
    expect((await envelope(await get(t))).data).toEqual({
      ...defaults,
      notifications: { push: true, email: true, marketing: true },
    });
    await patch(t, { notifications: { push: false } });
    expect(((await envelope(await get(t))).data as typeof defaults).notifications).toEqual({
      push: false,
      email: true,
      marketing: true,
    });
    expect(await testPrisma().userSettings.count()).toBe(1);
  });

  it("PATCH language outside the tenant's supported set -> 400 with details", async () => {
    const t = await signup("a@x.co");
    const res = await patch(t, { language: "xx" });
    expect(res.status).toBe(400);
    const env = await envelope(res);
    expect(env.error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: [{ path: "language" }],
    });
    expect(await testPrisma().userSettings.count()).toBe(0);
  });

  it("PATCH a supported language succeeds", async () => {
    const t = await signup("a@x.co");
    expect((await envelope(await patch(t, { language: "en" }))).data).toMatchObject({
      language: "en",
    });
  });

  it.each([[{}], [{ theme: "BLUE" }], [{ foo: 1 }], [{ notifications: { sms: true } }]])(
    "PATCH %j -> 400",
    async (body) => {
      const t = await signup("a@x.co");
      expect((await patch(t, body)).status).toBe(400);
    },
  );

  it("one user's PATCH is not visible to another user in the same tenant", async () => {
    const a = await signup("a@x.co");
    const b = await signup("b@x.co");
    await patch(a, { theme: "LIGHT" });
    expect(((await envelope(await get(b))).data as typeof defaults).theme).toBe("DARK");
  });

  it("tenants use their own defaults", async () => {
    const g = await signup("a@x.co", "globex");
    expect((await envelope(await get(g, "globex"))).data).toMatchObject({
      theme: "SYSTEM",
      language: "en",
    });
  });
});
