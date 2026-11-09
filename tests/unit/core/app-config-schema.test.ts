import { describe, expect, it } from "vitest";
import { AppConfigDocumentSchema } from "@/modules/app-config/app-config.schemas";

const base = {
  app: { displayName: "Acme" },
  support: {},
  legal: { privacyPolicyUrl: "https://a.test/p", termsUrl: "https://a.test/t" },
  passwordReset: { linkBaseUrl: "https://a.test/reset" },
  runtime: { defaultLanguage: "en", supportedLanguages: ["en"], defaultTheme: "SYSTEM" },
};
const withLink = (linkBaseUrl: string) =>
  AppConfigDocumentSchema.safeParse({ ...base, passwordReset: { linkBaseUrl } }).success;

describe("AppConfigDocumentSchema", () => {
  it("accepts a valid document with optional branding", () => {
    expect(AppConfigDocumentSchema.safeParse(base).success).toBe(true);
    expect(
      AppConfigDocumentSchema.safeParse({ ...base, branding: { primaryColor: "#0A1b2C" } }).success,
    ).toBe(true);
    expect(
      AppConfigDocumentSchema.safeParse({ ...base, branding: { primaryColor: "red" } }).success,
    ).toBe(false);
  });

  it.each([
    "https://example.com/reset",
    "acme://reset",
    "my-app.v2://x",
    "http://localhost:3000/r",
  ])("accepts linkBaseUrl %s", (u) => expect(withLink(u)).toBe(true));

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "http://example.com/reset",
    "nope",
    "",
  ])("rejects linkBaseUrl %s", (u) => expect(withLink(u)).toBe(false));

  it("rejects invalid legal url", () => {
    expect(
      AppConfigDocumentSchema.safeParse({
        ...base,
        legal: { ...base.legal, privacyPolicyUrl: "nope" },
      }).success,
    ).toBe(false);
  });
});
