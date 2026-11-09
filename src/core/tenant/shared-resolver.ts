import { AppError } from "../errors/app-error";
import { toContext, type TenantResolver } from "./resolver";
import { SLUG_PATTERN, type TenantContext, type TenantLookup } from "./tenant-context";

export class SharedTenantResolver implements TenantResolver {
  constructor(private readonly lookup: TenantLookup) {}

  async resolve(input: {
    clientId: string | null;
    tokenTenantId: string | null;
  }): Promise<TenantContext> {
    const { clientId, tokenTenantId } = input;

    if (tokenTenantId !== null) {
      const record = await this.lookup.findById(tokenTenantId);
      if (!record) throw new AppError("UNAUTHENTICATED", "Authentication required");
      // Any header that is not exactly the token's tenant (even malformed) is a mismatch.
      if (clientId !== null && clientId !== record.slug) {
        throw new AppError("TENANT_MISMATCH", "Client does not match the authenticated tenant");
      }
      return toContext(record, "token");
    }

    if (clientId === null || !SLUG_PATTERN.test(clientId)) {
      throw new AppError("INVALID_CLIENT", "A valid X-Client-Id header is required");
    }
    const record = await this.lookup.findBySlug(clientId);
    if (!record) throw new AppError("INVALID_CLIENT", "Unknown client");
    return toContext(record, "header");
  }

  async verifyStartup(): Promise<void> {}
}
