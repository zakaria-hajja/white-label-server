import type { PrismaClient } from "@/core/database/prisma";
import { AppError } from "@/core/errors/app-error";
import type { RouteContext } from "@/core/http/route";
import type { Clock } from "../../shared/clock";

const TTL_MS = 30_000;

export interface FeatureFlags {
  all(tenantId: string): Promise<Record<string, boolean>>;
  /** Unknown key -> false. */
  isEnabled(tenantId: string, key: string): Promise<boolean>;
  invalidate(): void;
}

export interface FlagSource {
  load(tenantId: string): Promise<Record<string, boolean>>;
}

export class PrismaFlagSource implements FlagSource {
  constructor(private readonly prisma: PrismaClient) {}

  async load(tenantId: string): Promise<Record<string, boolean>> {
    const rows = await this.prisma.featureFlag.findMany({
      where: { tenantId },
      select: { key: true, enabled: true },
      orderBy: { key: "asc" },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
  }
}

/** Caches each tenant's flags for 30 s. */
export class CachedFeatureFlags implements FeatureFlags {
  private readonly entries = new Map<string, { flags: Record<string, boolean>; expires: number }>();

  constructor(
    private readonly source: FlagSource,
    private readonly clock: Clock,
  ) {}

  async all(tenantId: string): Promise<Record<string, boolean>> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(tenantId);
    if (hit && hit.expires > now) return hit.flags;
    const flags = await this.source.load(tenantId);
    this.entries.set(tenantId, { flags, expires: now + TTL_MS });
    return flags;
  }

  async isEnabled(tenantId: string, key: string): Promise<boolean> {
    return (await this.all(tenantId))[key] === true;
  }

  invalidate(): void {
    this.entries.clear();
  }
}

/** Guards a route behind a tenant feature flag: disabled -> 404 FEATURE_DISABLED. */
export async function requireFeature(
  c: Pick<RouteContext<unknown, unknown, unknown>, "tenant" | "container">,
  key: string,
): Promise<void> {
  if (!c.tenant) throw new Error("requireFeature needs a route with tenant: required");
  if (!(await c.container.featureFlags.isEnabled(c.tenant.tenantId, key))) {
    throw new AppError("FEATURE_DISABLED");
  }
}
