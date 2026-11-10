import "dotenv/config";
import { loadConfig } from "../src/core/config/env";
import { createPrisma } from "../src/core/database/prisma";
import { pruneAuthData } from "../src/core/database/prune";
import { systemClock } from "../src/shared/clock";

/**
 * Deletes dead refresh tokens, sessions and password reset tokens (see pruneAuthData). Meant for
 * production: run it as a periodic job (e.g. daily) against each deployment's database.
 */
async function run() {
  const config = loadConfig(process.env);
  const prisma = createPrisma(config.databaseUrl);
  try {
    return await pruneAuthData(prisma, systemClock);
  } finally {
    await prisma.$disconnect();
  }
}

run()
  .then((counts) => console.log(JSON.stringify({ deleted: counts }, null, 2)))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
