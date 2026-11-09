import { expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { testPrisma } from "../../helpers/db";

it("seeds only the dedicated tenant, idempotently", async () => {
  const cfg = { mode: "dedicated" as const, dedicatedTenantSlug: "acme", nodeEnv: "test" };
  await seed(testPrisma(), cfg);
  await seed(testPrisma(), cfg);
  const tenants = await testPrisma().tenant.findMany();
  expect(tenants.map((t) => [t.slug, t.name])).toEqual([["acme", "Acme"]]);
  expect(await testPrisma().user.count()).toBe(2);
  expect(await testPrisma().catalogItem.count()).toBe(25);
});
