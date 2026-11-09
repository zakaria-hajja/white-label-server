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
  setContainer(createContainer(loadConfig(process.env), { prisma: testPrisma() }));
});

describe("tenant resolution (shared)", () => {
  it("resolves a seeded tenant from X-Client-Id", async () => {
    await createTenant("acme");
    const res = await call({ "x-client-id": "acme" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "acme", source: "header" });
  });

  it("rejects a missing header and an unknown tenant with INVALID_CLIENT", async () => {
    for (const headers of [
      {} as Record<string, string>,
      { "x-client-id": "ghost" },
      { "x-client-id": "Bad_Slug" },
    ]) {
      const res = await call(headers);
      expect(res.status).toBe(400);
      expect((await envelope(res)).error).toMatchObject({ code: "INVALID_CLIENT" });
    }
  });

  it("rejects a suspended tenant with TENANT_SUSPENDED", async () => {
    await createTenant("sleepy", { status: "SUSPENDED" });
    const res = await call({ "x-client-id": "sleepy" });
    expect(res.status).toBe(403);
    expect((await envelope(res)).error).toMatchObject({ code: "TENANT_SUSPENDED" });
  });
});
