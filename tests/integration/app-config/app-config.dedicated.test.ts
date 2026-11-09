import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { TenantAdminService } from "@/core/tenant/tenant-admin.service";
import { GET } from "@/app/api/v1/app/config/route";

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(loadConfig(process.env), { prisma: testPrisma() }));
  await new TenantAdminService(testPrisma()).create({ slug: "acme", name: "Acme" });
});

describe("GET /app/config (dedicated)", () => {
  it("returns the configured tenant's config without a header", async () => {
    const res = await GET(new Request("http://localhost/api/v1/app/config"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toMatchObject({
      tenant: { slug: "acme", name: "Acme" },
      app: { displayName: "Acme" },
      features: { catalog: true },
    });
  });
});
