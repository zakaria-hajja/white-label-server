import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });

const BLOCKED_SCHEMES = new Set(["javascript", "data", "file", "vbscript", "blob", "about"]);
const CUSTOM_SCHEME = /^([a-z][a-z0-9+.-]*):\/\/\S+$/;

/** https URL, http only for localhost, or a custom app scheme such as `acme://reset`. */
const linkBaseUrl = z.string().refine((value) => {
  const custom = CUSTOM_SCHEME.exec(value);
  if (custom) {
    const scheme = custom[1] as string;
    if (scheme === "https") return z.url({ protocol: /^https$/ }).safeParse(value).success;
    if (scheme === "http") {
      return (
        z.url({ protocol: /^http$/ }).safeParse(value).success &&
        ["localhost", "127.0.0.1"].includes(new URL(value).hostname)
      );
    }
    return !BLOCKED_SCHEMES.has(scheme);
  }
  return false;
}, "must be an https URL, an http://localhost URL, or a custom app scheme URL");

export const AppConfigDocumentSchema = z.object({
  app: z.object({
    displayName: z.string().min(1).max(80),
    minSupportedVersionCode: z.number().int().min(1).optional(),
    latestVersionCode: z.number().int().min(1).optional(),
  }),
  support: z.object({
    email: z.email().optional(),
    phone: z.string().max(32).optional(),
    url: httpUrl.optional(),
  }),
  legal: z.object({ privacyPolicyUrl: httpUrl, termsUrl: httpUrl }),
  passwordReset: z.object({ linkBaseUrl }),
  runtime: z.object({
    defaultLanguage: z.string().min(2).max(10),
    supportedLanguages: z.array(z.string()).min(1),
    defaultTheme: z.enum(["SYSTEM", "LIGHT", "DARK"]),
  }),
  branding: z
    .object({
      primaryColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      logoUrl: httpUrl.optional(),
    })
    .optional(),
});

export type AppConfigDocument = z.infer<typeof AppConfigDocumentSchema>;
