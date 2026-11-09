import type { Prisma, Tenant } from "@/generated/prisma/client";
import { createPrisma, type PrismaClient } from "@/core/database/prisma";

let client: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for integration tests");
  client ??= createPrisma(url);
  return client;
}

/** Truncates every app table (all public tables except Prisma's migrations table). */
export async function resetDb(): Promise<void> {
  const prisma = testPrisma();
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

export async function disconnectDb(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

export function createTenant(
  slug: string,
  overrides: Partial<Prisma.TenantUncheckedCreateInput> = {},
): Promise<Tenant> {
  return testPrisma().tenant.create({ data: { slug, name: slug, ...overrides } });
}
