import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/core/database/prisma-errors";
import { createTenant, testPrisma } from "../../helpers/db";

async function createUser(tenantId: string, email: string) {
  return testPrisma().user.create({
    data: { tenantId, email, passwordHash: "hash", firstName: "A", lastName: "B" },
  });
}

describe("database schema", () => {
  it("rejects the same email twice within one tenant", async () => {
    const tenant = await createTenant("acme");
    await createUser(tenant.id, "a@example.com");
    const err = await createUser(tenant.id, "a@example.com").catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("allows the same email in different tenants", async () => {
    const a = await createTenant("acme");
    const b = await createTenant("globex");
    await createUser(a.id, "a@example.com");
    await expect(createUser(b.id, "a@example.com")).resolves.toBeDefined();
  });

  it("rejects a session whose tenant differs from its user's tenant", async () => {
    const a = await createTenant("acme");
    const b = await createTenant("globex");
    const user = await createUser(a.id, "a@example.com");
    await expect(
      testPrisma().session.create({
        data: { tenantId: b.id, userId: user.id, expiresAt: new Date(Date.now() + 1000) },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("cascades tenant deletion to users", async () => {
    const tenant = await createTenant("acme");
    await createUser(tenant.id, "a@example.com");
    await testPrisma().tenant.delete({ where: { id: tenant.id } });
    expect(await testPrisma().user.count()).toBe(0);
  });
});
