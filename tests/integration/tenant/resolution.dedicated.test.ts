import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { route } from "@/core/http/route";

const ctx = { params: Promise.resolve({}) };
const probe = route({
  auth: "none",
  tenant: "required",
  handler: async ({ tenant }) => Response.json({ slug: tenant.slug, source: tenant.source }),
});
const call = (headers: Record<string, string> = {}) =>
  probe(new Request("http://localhost/probe", { headers }), ctx);

beforeEach(async () => {
  await resetDb();
  await createTenant("acme");
  // A fresh container per test so the 30 s tenant cache never leaks between tests.
  setContainer(createContainer(loadConfig(process.env), { prisma: testPrisma() }));
});

describe("tenant resolution (dedicated)", () => {
  it("resolves the configured tenant without a header", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "acme", source: "deployment" });
  });

  it("accepts the matching header and rejects another slug", async () => {
    expect((await call({ "x-client-id": "acme" })).status).toBe(200);
    await createTenant("globex");
    const res = await call({ "x-client-id": "globex" });
    expect(res.status).toBe(400);
    expect((await envelope(res)).error).toMatchObject({ code: "INVALID_CLIENT" });
  });

  it("verifyStartup passes for the seeded tenant", async () => {
    const { getContainer } = await import("@/core/container");
    await expect(getContainer().tenantResolver.verifyStartup()).resolves.toBeUndefined();
  });
});
