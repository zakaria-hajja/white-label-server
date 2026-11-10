import { exampleEnvelope, FIXTURE_TENANT } from "@/core/openapi/fixtures";
import type { AppConfigDocument } from "./app-config.schemas";
import { buildPublicAppConfig } from "./app-config.service";

export const appConfigFixtures = {
  document: {
    app: { displayName: "Showcase", minSupportedVersionCode: 3, latestVersionCode: 7 },
    support: { email: "support@example.com", url: "https://example.com/help" },
    legal: {
      privacyPolicyUrl: "https://example.com/privacy",
      termsUrl: "https://example.com/terms",
    },
    passwordReset: { linkBaseUrl: "https://example.com/reset-password" },
    runtime: { defaultLanguage: "en", supportedLanguages: ["en", "fr"], defaultTheme: "SYSTEM" },
    branding: { primaryColor: "#3B5BDB", logoUrl: "https://example.com/logo.png" },
  } satisfies AppConfigDocument,
  features: { catalog: true, profile: true },
};

export const appConfigExample = exampleEnvelope(
  buildPublicAppConfig(appConfigFixtures.document, appConfigFixtures.features, FIXTURE_TENANT),
);
