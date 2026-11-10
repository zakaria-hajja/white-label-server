import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/tenant-context";
import type { AppConfigDocument } from "@/modules/app-config/app-config.schemas";
import { PublicAppConfigSchema } from "@/modules/app-config/app-config.schemas";
import { AppConfigService } from "@/modules/app-config/app-config.service";

const ctx: TenantContext = { tenantId: "t1", slug: "acme", name: "Acme Inc", source: "header" };
const base = {
  app: { displayName: "Acme App" },
  support: {},
  legal: { privacyPolicyUrl: "https://a.test/p", termsUrl: "https://a.test/t" },
  passwordReset: { linkBaseUrl: "https://a.test/reset" },
  runtime: { defaultLanguage: "en", supportedLanguages: ["en"], defaultTheme: "SYSTEM" },
} as AppConfigDocument;

const service = (doc: AppConfigDocument) =>
  new AppConfigService({ getDocument: () => Promise.resolve(doc) }, {
    all: () => Promise.resolve({ catalog: true, beta: false }),
  } as never);

describe("AppConfigService.getPublic", () => {
  it("builds the allowlisted shape", async () => {
    const out = await service(base).getPublic(ctx);
    expect(out).toEqual({
      tenant: { slug: "acme", name: "Acme Inc" },
      app: { displayName: "Acme App" },
      features: { catalog: true, beta: false },
      support: {},
      legal: { privacyPolicyUrl: "https://a.test/p", termsUrl: "https://a.test/t" },
      runtime: { defaultLanguage: "en", supportedLanguages: ["en"], defaultTheme: "SYSTEM" },
    });
    expect("branding" in out).toBe(false);
    expect(PublicAppConfigSchema.safeParse(out).success).toBe(true);
  });

  it("includes optional groups and drops unknown stored keys", async () => {
    const doc = {
      ...base,
      app: { displayName: "X", latestVersionCode: 5, secret: "s" },
      support: { email: "a@b.co", extra: "no" },
      branding: { primaryColor: "#112233", hidden: "no" },
    } as unknown as AppConfigDocument;
    const out = await service(doc).getPublic(ctx);
    expect(out.app).toEqual({ displayName: "X", latestVersionCode: 5 });
    expect(out.support).toEqual({ email: "a@b.co" });
    expect(out.branding).toEqual({ primaryColor: "#112233" });
    expect(JSON.stringify(out)).not.toMatch(/passwordReset|linkBaseUrl|secret|hidden|extra/);
  });
});
