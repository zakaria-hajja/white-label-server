import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { loadConfig } from "../src/core/config/env";
import { createPrisma } from "../src/core/database/prisma";
import { TenantAdminService } from "../src/core/tenant/tenant-admin.service";

const USAGE = `Usage: npm run tenant -- <command> [options]
  create      --slug <slug> --name <name> [--config <file.json>]
  list
  set-status  --slug <slug> --status ACTIVE|SUSPENDED
  set-config  --slug <slug> --file <file.json>
  set-feature --slug <slug> --key <key> --enabled true|false`;

class UsageError extends Error {}

function need(value: string | undefined, flag: string): string {
  if (!value) throw new UsageError(`Missing --${flag}\n${USAGE}`);
  return value;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new UsageError(`Cannot read JSON from ${path}: ${(err as Error).message}`);
  }
}

async function run(): Promise<unknown> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      slug: { type: "string" },
      name: { type: "string" },
      config: { type: "string" },
      file: { type: "string" },
      status: { type: "string" },
      key: { type: "string" },
      enabled: { type: "string" },
    },
  });
  const command = positionals[0];
  if (!command) throw new UsageError(USAGE);

  const config = loadConfig(process.env);
  const prisma = createPrisma(config.databaseUrl);
  const admin = new TenantAdminService(prisma);
  try {
    switch (command) {
      case "create":
        return await admin.create({
          slug: need(values.slug, "slug"),
          name: need(values.name, "name"),
          config: values.config ? (readJson(values.config) as never) : undefined,
        });
      case "list":
        return await admin.list();
      case "set-status": {
        const status = need(values.status, "status");
        if (status !== "ACTIVE" && status !== "SUSPENDED") {
          throw new UsageError("--status must be ACTIVE or SUSPENDED");
        }
        return await admin.setStatus(need(values.slug, "slug"), status);
      }
      case "set-config":
        return await admin.setConfig(
          need(values.slug, "slug"),
          readJson(need(values.file, "file")),
        );
      case "set-feature": {
        const enabled = need(values.enabled, "enabled");
        if (enabled !== "true" && enabled !== "false") {
          throw new UsageError("--enabled must be true or false");
        }
        return await admin.setFeature(
          need(values.slug, "slug"),
          need(values.key, "key"),
          enabled === "true",
        );
      }
      default:
        throw new UsageError(`Unknown command "${command}"\n${USAGE}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

run()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((err: unknown) => {
    let message: string;
    if (err instanceof ZodError) {
      message = `Invalid configuration: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
    } else {
      message = err instanceof Error ? err.message : String(err);
    }
    console.error(message);
    process.exit(1);
  });
