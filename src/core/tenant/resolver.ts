import { AppError } from "../errors/app-error";
import type { TenantContext, TenantRecord } from "./tenant-context";

export interface TenantResolver {
  resolve(input: { clientId: string | null; tokenTenantId: string | null }): Promise<TenantContext>;
  /** Fails fast at boot when the deployment's tenant cannot serve requests. */
  verifyStartup(): Promise<void>;
}

/** Builds the context for a validated tenant; the only place suspension is enforced. */
export function toContext(record: TenantRecord, source: TenantContext["source"]): TenantContext {
  if (record.status === "SUSPENDED") {
    throw new AppError("TENANT_SUSPENDED", "This tenant is suspended");
  }
  return { tenantId: record.id, slug: record.slug, name: record.name, source };
}
