import { SuccessEnvelope, registerOperation } from "@/core/openapi/components";
import { registry, TAGS } from "@/core/openapi/registry";
import { PublicAppConfigSchema } from "./app-config.schemas";
import { appConfigExample } from "./app-config.examples";

export const AppConfigEnvelope = SuccessEnvelope(
  "AppConfigEnvelope",
  registry.register("PublicAppConfig", PublicAppConfigSchema),
);

registerOperation({
  method: "get",
  path: "/api/v1/app/config",
  operationId: "appConfigGet",
  tag: TAGS.appConfig,
  summary: "Public tenant configuration for the app",
  description:
    "Branding, feature flags, supported languages and legal links. No bearer token needed. " +
    "Cacheable for 60 seconds; caches must key on X-Client-Id.",
  auth: "none",
  tenant: "required",
  success: [
    {
      status: 200,
      description: "The tenant's public config",
      schema: AppConfigEnvelope,
      example: appConfigExample,
      headers: {
        "Cache-Control": { description: "public, max-age=60", schema: { type: "string" } },
        Vary: { description: "X-Client-Id", schema: { type: "string" } },
      },
    },
  ],
});
