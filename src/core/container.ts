import type { Logger } from "pino";
import { loadConfig, type AppConfig } from "./config/env";
import { createPrisma, type PrismaClient } from "./database/prisma";
import { createLogger } from "./logging/logger";
import { systemClock, type Clock } from "../shared/clock";
import { DedicatedTenantResolver } from "./tenant/dedicated-resolver";
import type { TenantResolver } from "./tenant/resolver";
import { SharedTenantResolver } from "./tenant/shared-resolver";
import { CachedTenantLookup } from "./tenant/tenant-cache";
import { PrismaTenantLookup } from "./tenant/tenant.repository";

export type { Logger };

// Task 8 adds rateLimiter and services.
export type Container = {
  config: AppConfig;
  prisma: PrismaClient;
  logger: Logger;
  clock: Clock;
  tenantLookup: CachedTenantLookup;
  tenantResolver: TenantResolver;
};

export function createContainer(config: AppConfig, overrides: Partial<Container> = {}): Container {
  const prisma = overrides.prisma ?? createPrisma(config.databaseUrl);
  const clock = overrides.clock ?? systemClock;
  const tenantLookup =
    overrides.tenantLookup ?? new CachedTenantLookup(new PrismaTenantLookup(prisma), clock);
  // The only place the deployment mode is read.
  const tenantResolver =
    overrides.tenantResolver ??
    (config.mode === "dedicated"
      ? new DedicatedTenantResolver(tenantLookup, config)
      : new SharedTenantResolver(tenantLookup));
  return {
    config,
    prisma,
    logger: overrides.logger ?? createLogger(config.logLevel),
    clock,
    tenantLookup,
    tenantResolver,
  };
}

let current: Container | null = null;

/** Lazy singleton built from process.env. */
export function getContainer(): Container {
  current ??= createContainer(loadConfig(process.env));
  return current;
}

/** Tests only. */
export function setContainer(c: Container | null): void {
  current = c;
}
