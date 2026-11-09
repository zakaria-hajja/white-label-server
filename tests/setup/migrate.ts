import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

/** Applies migrations to the project's own test database before its tests run. */
export default function migrate(project: TestProject): void {
  const databaseUrl = project.config.env?.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing from project env");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}
