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
import { PrismaSessionCheck, type SessionCheck } from "./auth/session-check";
import { PrismaAuthRepository } from "../modules/auth/auth.repository";
import { AuthService } from "../modules/auth/auth.service";
import { InMemoryRateLimiter, type RateLimiter } from "./rate-limit/rate-limiter";

export type { Logger };

export type Container = {
  config: AppConfig;
  prisma: PrismaClient;
  logger: Logger;
  clock: Clock;
  tenantLookup: CachedTenantLookup;
  tenantResolver: TenantResolver;
  rateLimiter: RateLimiter;
  sessionCheck: SessionCheck;
  services: { auth: AuthService };
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
  const logger = overrides.logger ?? createLogger(config.logLevel);
  if (config.nodeEnv === "production" && !config.trustProxy) {
    logger.warn("TRUST_PROXY is false: client IP is unknown, so IP-based rate limits are disabled");
  }
  return {
    config,
    prisma,
    logger,
    clock,
    tenantLookup,
    tenantResolver,
    rateLimiter: overrides.rateLimiter ?? new InMemoryRateLimiter(clock),
    sessionCheck: overrides.sessionCheck ?? new PrismaSessionCheck(prisma, logger),
    services: overrides.services ?? {
      auth: new AuthService(
        new PrismaAuthRepository(prisma),
        { jwt: config.jwt, sessionTtlDays: config.sessionTtlDays },
        clock,
      ),
    },
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
