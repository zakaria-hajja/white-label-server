import { SuccessEnvelope, registerOperation } from "@/core/openapi/components";
import { registry, TAGS } from "@/core/openapi/registry";
import { SettingsDtoSchema, updateSettingsBody } from "./settings.schemas";
import { settingsBodyExample, settingsInvalidExample, settingsExamples } from "./settings.examples";

export const SettingsEnvelope = SuccessEnvelope(
  "SettingsEnvelope",
  registry.register("SettingsDto", SettingsDtoSchema),
);
const base = { tag: TAGS.settings, tenant: "required", auth: "required" } as const;

registerOperation({
  ...base,
  method: "get",
  path: "/api/v1/settings",
  operationId: "settingsGet",
  summary: "Get the user's settings",
  description: "Tenant defaults when the user has not saved any.",
  success: [
    {
      status: 200,
      description: "Settings",
      schema: SettingsEnvelope,
      example: settingsExamples.defaults,
    },
  ],
});

registerOperation({
  ...base,
  method: "patch",
  path: "/api/v1/settings",
  operationId: "settingsUpdate",
  summary: "Update the user's settings",
  description:
    "Partial update; send at least one field. `language` must be one of the tenant's supported languages " +
    "(see GET /app/config), otherwise VALIDATION_ERROR.",
  body: updateSettingsBody,
  bodyExample: settingsBodyExample,
  invalidExample: settingsInvalidExample,
  success: [
    {
      status: 200,
      description: "The merged settings",
      schema: SettingsEnvelope,
      example: settingsExamples.stored,
    },
  ],
});
