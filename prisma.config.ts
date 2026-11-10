import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    // Only used by `prisma migrate diff --from-migrations` (CI drift check).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
