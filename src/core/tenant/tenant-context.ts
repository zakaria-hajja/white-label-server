export type TenantContext = Readonly<{
  tenantId: string;
  slug: string;
  name: string;
  source: "header" | "token" | "deployment";
}>;

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
};

export interface TenantLookup {
  findBySlug(slug: string): Promise<TenantRecord | null>;
  findById(id: string): Promise<TenantRecord | null>;
}

export const CLIENT_ID_HEADER = "x-client-id";
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
