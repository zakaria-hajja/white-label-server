import type { Logger } from "pino";
import { loadConfig, type AppConfig } from "./config/env";
import { createPrisma, type PrismaClient } from "./database/prisma";
import { createLogger } from "./logging/logger";
import { systemClock, type Clock } from "../shared/clock";

export type { Logger };

// Tasks 6 and 8 add tenantResolver, rateLimiter and services.
export type Container = {
  config: AppConfig;
  prisma: PrismaClient;
  logger: Logger;
  clock: Clock;
};

export function createContainer(config: AppConfig, overrides: Partial<Container> = {}): Container {
  return {
    config,
    prisma: overrides.prisma ?? createPrisma(config.databaseUrl),
    logger: overrides.logger ?? createLogger(config.logLevel),
    clock: overrides.clock ?? systemClock,
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
