import type { TenantContext } from "@/core/tenant/tenant-context";
import type { AppConfigReader } from "./app-config.reader";
import type { AppConfigDocument, PublicAppConfig } from "./app-config.schemas";
import type { FeatureFlags } from "./feature-flags";

/**
 * The public config. Explicit allowlist: every field is copied by name; stored objects are never
 * spread. Pure, so the OpenAPI example is computed with it.
 */
export function buildPublicAppConfig(
  doc: AppConfigDocument,
  features: Record<string, boolean>,
  tenant: { slug: string; name: string },
): PublicAppConfig {
  const { app, support, legal, runtime, branding } = doc;
  const out: PublicAppConfig = {
    tenant: { slug: tenant.slug, name: tenant.name },
    app: {
      displayName: app.displayName,
      ...(app.minSupportedVersionCode !== undefined && {
        minSupportedVersionCode: app.minSupportedVersionCode,
      }),
      ...(app.latestVersionCode !== undefined && { latestVersionCode: app.latestVersionCode }),
    },
    features: { ...features },
    support: {
      ...(support.email !== undefined && { email: support.email }),
      ...(support.phone !== undefined && { phone: support.phone }),
      ...(support.url !== undefined && { url: support.url }),
    },
    legal: { privacyPolicyUrl: legal.privacyPolicyUrl, termsUrl: legal.termsUrl },
    runtime: {
      defaultLanguage: runtime.defaultLanguage,
      supportedLanguages: [...runtime.supportedLanguages],
      defaultTheme: runtime.defaultTheme,
    },
  };
  if (branding) {
    out.branding = {
      ...(branding.primaryColor !== undefined && { primaryColor: branding.primaryColor }),
      ...(branding.logoUrl !== undefined && { logoUrl: branding.logoUrl }),
    };
  }
  return out;
}

export class AppConfigService {
  constructor(
    private readonly reader: AppConfigReader,
    private readonly flags: Pick<FeatureFlags, "all">,
  ) {}

  async getPublic(ctx: TenantContext): Promise<PublicAppConfig> {
    const [doc, features] = await Promise.all([
      this.reader.getDocument(ctx.tenantId),
      this.flags.all(ctx.tenantId),
    ]);
    return buildPublicAppConfig(doc, features, ctx);
  }
}
