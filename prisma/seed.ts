import "dotenv/config";
import { loadConfig } from "../src/core/config/env";
import { createPrisma } from "../src/core/database/prisma";
import { seed } from "./seed-data";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const prisma = createPrisma(config.databaseUrl);
  try {
    await seed(prisma, config);
    console.log(`Seeded (${config.mode} mode).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`Seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
