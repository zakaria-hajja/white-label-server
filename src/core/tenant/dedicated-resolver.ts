import type { AppConfig } from "../config/env";
import { AppError } from "../errors/app-error";
import { toContext, type TenantResolver } from "./resolver";
import type { TenantContext, TenantLookup, TenantRecord } from "./tenant-context";

export class DedicatedTenantResolver implements TenantResolver {
  private readonly slug: string;

  constructor(
    private readonly lookup: TenantLookup,
    config: Pick<AppConfig, "dedicatedTenantSlug">,
  ) {
    if (!config.dedicatedTenantSlug) throw new Error("DEDICATED_TENANT_SLUG is required");
    this.slug = config.dedicatedTenantSlug;
  }

  async resolve(input: {
    clientId: string | null;
    tokenTenantId: string | null;
  }): Promise<TenantContext> {
    const { clientId, tokenTenantId } = input;
    if (clientId !== null && clientId !== this.slug) {
      throw new AppError("INVALID_CLIENT", "Unknown client");
    }
    // Goes through the cached lookup, so a later suspension applies within its TTL.
    const record = await this.load();
    if (!record) throw new Error(`Dedicated tenant "${this.slug}" not found`);
    if (tokenTenantId !== null && tokenTenantId !== record.id) {
      throw new AppError("UNAUTHENTICATED", "Authentication required");
    }
    return toContext(record, "deployment");
  }

  async verifyStartup(): Promise<void> {
    const record = await this.load();
    if (!record) throw new Error(`Dedicated tenant "${this.slug}" does not exist`);
    if (record.status === "SUSPENDED") {
      throw new Error(`Dedicated tenant "${this.slug}" is suspended`);
    }
  }

  private load(): Promise<TenantRecord | null> {
    return this.lookup.findBySlug(this.slug);
  }
}
