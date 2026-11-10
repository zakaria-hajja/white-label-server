import { exampleEnvelope } from "@/core/openapi/fixtures";
import { appConfigFixtures } from "../app-config/app-config.examples";
import { buildSettingsDto } from "./settings.service";

/** The body applied to `stored` gives `stored` again, so one example serves GET and PATCH. */
export const settingsBodyExample = { theme: "DARK" as const, notifications: { marketing: false } };

export const settingsFixtures = {
  stored: {
    theme: "DARK" as const,
    language: "en",
    notificationPreferences: { push: false, email: true, marketing: false },
  },
};

export const settingsExamples = {
  defaults: exampleEnvelope(buildSettingsDto(null, appConfigFixtures.document.runtime)),
  stored: exampleEnvelope(buildSettingsDto(settingsFixtures.stored)),
};

/** Fails validation; the 400 example is the real VALIDATION_ERROR for it. */
export const settingsInvalidExample = { theme: "BLUE" };
