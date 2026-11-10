import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@/core/config/env";

const SECRET = "s".repeat(40);
const base = {
  DEPLOYMENT_MODE: "shared",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_SECRET: SECRET,
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.mode).toBe("shared");
    expect(c.jwt.accessTtlSeconds).toBe(900);
    expect(c.jwt.issuer).toBe("whitelabel-api");
    expect(c.jwt.audience).toBe("whitelabel-api");
    expect(c.jwt.secret).toBeInstanceOf(Uint8Array);
    expect(c.sessionTtlDays).toBe(30);
    expect(c.passwordResetTtlMinutes).toBe(30);
    expect(c.maxBodyBytes).toBe(65536);
    expect(c.trustProxy).toBe(false);
    expect(c.dedicatedTenantSlug).toBeNull();
    expect(c.mailer).toBe("console");
  });

  it("accepts dedicated with a slug", () => {
    const c = loadConfig({ ...base, DEPLOYMENT_MODE: "dedicated", DEDICATED_TENANT_SLUG: "acme" });
    expect(c.mode).toBe("dedicated");
    expect(c.dedicatedTenantSlug).toBe("acme");
  });

  it("parses TRUST_PROXY=true", () => {
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });

  it("defaults TRUST_PROXY_HOPS to 1 and parses it", () => {
    expect(loadConfig(base).trustProxyHops).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY_HOPS: "2" }).trustProxyHops).toBe(2);
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects TRUST_PROXY_HOPS=%s", (v) => {
    expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: v })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it("rejects missing DEPLOYMENT_MODE", () => {
    expect(() => loadConfig({ ...base, DEPLOYMENT_MODE: undefined })).toThrow(ConfigError);
  });

  it("rejects DEPLOYMENT_MODE=multi", () => {
    expect(() => loadConfig({ ...base, DEPLOYMENT_MODE: "multi" })).toThrow(/DEPLOYMENT_MODE/);
  });

  it("rejects a short JWT_SECRET without echoing it", () => {
    const short = "tooshort-secret-value";
    let message = "";
    try {
      loadConfig({ ...base, JWT_SECRET: short });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("JWT_SECRET");
    expect(message).not.toContain(short);
  });

  it("rejects dedicated without DEDICATED_TENANT_SLUG", () => {
    expect(() => loadConfig({ ...base, DEPLOYMENT_MODE: "dedicated" })).toThrow(
      /DEDICATED_TENANT_SLUG/,
    );
  });

  it("rejects shared with DEDICATED_TENANT_SLUG", () => {
    expect(() => loadConfig({ ...base, DEDICATED_TENANT_SLUG: "acme" })).toThrow(
      /DEDICATED_TENANT_SLUG/,
    );
  });

  it("reports all invalid vars in one error", () => {
    let message = "";
    try {
      loadConfig({ DEPLOYMENT_MODE: "x", JWT_SECRET: "a" });
    } catch (e) {
      message = (e as Error).message;
    }
    for (const v of ["DEPLOYMENT_MODE", "DATABASE_URL", "JWT_SECRET"]) expect(message).toContain(v);
  });

  it("enforces numeric ranges", () => {
    expect(() => loadConfig({ ...base, ACCESS_TOKEN_TTL_SECONDS: "10" })).toThrow(
      /ACCESS_TOKEN_TTL_SECONDS/,
    );
  });
});
