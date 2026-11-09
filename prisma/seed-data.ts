import { hashPassword } from "../src/core/auth/password";
import type { PrismaClient } from "../src/core/database/prisma";
import { TenantAdminService } from "../src/core/tenant/tenant-admin.service";
import type { AppConfig } from "../src/core/config/env";

export const SEED_PASSWORD = "Password123!";
const CATEGORIES = ["Books", "Music", "Games", "Travel"];
const SHARED_TITLE = "Shared Title Example";
const USERS = [
  { email: "alice@shared.test", firstName: "Alice", lastName: "Anderson" },
  { email: "bob@shared.test", firstName: "Bob", lastName: "Brown" },
];

type Tenants = { slug: string; name: string }[];

function tenantsFor(config: Pick<AppConfig, "mode" | "dedicatedTenantSlug">): Tenants {
  if (config.mode === "dedicated") {
    const slug = config.dedicatedTenantSlug;
    if (!slug) throw new Error("DEDICATED_TENANT_SLUG is required in dedicated mode");
    return [{ slug, name: slug.charAt(0).toUpperCase() + slug.slice(1) }];
  }
  return [
    { slug: "acme", name: "Acme" },
    { slug: "globex", name: "Globex" },
  ];
}

/** Idempotent: tenants/users are upserted, catalog items are skipped when a tenant already has any. */
export async function seed(
  prisma: PrismaClient,
  config: Pick<AppConfig, "mode" | "dedicatedTenantSlug" | "nodeEnv">,
): Promise<void> {
  if (config.nodeEnv === "production") {
    throw new Error("Refusing to seed: NODE_ENV is production");
  }
  const admin = new TenantAdminService(prisma);
  const passwordHash = await hashPassword(SEED_PASSWORD);

  for (const { slug, name } of tenantsFor(config)) {
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    const tenant = existing ?? (await admin.create({ slug, name }));

    for (const u of USERS) {
      await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
        create: { tenantId: tenant.id, passwordHash, ...u },
        update: {},
      });
    }

    if ((await prisma.catalogItem.count({ where: { tenantId: tenant.id } })) === 0) {
      const items = Array.from({ length: 24 }, (_, i) => ({
        tenantId: tenant.id,
        title: `${name} Item ${i + 1}`,
        description: `Sample item ${i + 1} for ${name}`,
        category: CATEGORIES[i % CATEGORIES.length] ?? null,
      }));
      items.push({
        tenantId: tenant.id,
        title: SHARED_TITLE,
        description: "Same title in every tenant",
        category: CATEGORIES[0] ?? null,
      });
      await prisma.catalogItem.createMany({ data: items });
    }
  }
}
