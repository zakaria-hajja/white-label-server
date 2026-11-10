import { z } from "zod";

export type DeploymentMode = "shared" | "dedicated";

export type AppConfig = {
  mode: DeploymentMode;
  databaseUrl: string;
  dedicatedTenantSlug: string | null;
  jwt: {
    secret: Uint8Array;
    issuer: string;
    audience: "whitelabel-api";
    accessTtlSeconds: number;
  };
  sessionTtlDays: number;
  passwordResetTtlMinutes: number;
  trustProxy: boolean;
  /** Proxies we control in front of the app; the client IP is this many X-Forwarded-For entries from the right. */
  trustProxyHops: number;
  logLevel: string;
  mailer: "console";
  maxBodyBytes: number;
  nodeEnv: string;
};

export class ConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Invalid configuration: ${variables.join(", ")}`);
    this.name = "ConfigError";
  }
}

const emptyAsUndefined = (v: unknown) => (v === "" ? undefined : v);
const int = (min: number, max: number, def: number) =>
  z.preprocess(emptyAsUndefined, z.coerce.number().int().min(min).max(max).default(def));
const str = <T extends z.ZodType>(s: T) => z.preprocess(emptyAsUndefined, s);

const schema = z
  .object({
    DEPLOYMENT_MODE: z.enum(["shared", "dedicated"]),
    DATABASE_URL: z.string().min(1),
    DEDICATED_TENANT_SLUG: str(z.string().min(1).optional()),
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: str(z.string().min(1).default("whitelabel-api")),
    ACCESS_TOKEN_TTL_SECONDS: int(60, 3600, 900),
    REFRESH_SESSION_TTL_DAYS: int(1, 365, 30),
    PASSWORD_RESET_TTL_MINUTES: int(5, 1440, 30),
    TRUST_PROXY: str(z.enum(["true", "false"]).default("false")),
    TRUST_PROXY_HOPS: int(1, 20, 1),
    LOG_LEVEL: str(z.string().min(1).default("info")),
    MAILER: str(z.literal("console").default("console")),
    MAX_BODY_BYTES: int(1, 10_485_760, 65536),
    NODE_ENV: str(z.string().min(1).default("development")),
  })
  .superRefine((v, ctx) => {
    if (v.DEPLOYMENT_MODE === "dedicated" && !v.DEDICATED_TENANT_SLUG) {
      ctx.addIssue({
        code: "custom",
        path: ["DEDICATED_TENANT_SLUG"],
        message: "required in dedicated mode",
      });
    }
    if (v.DEPLOYMENT_MODE === "shared" && v.DEDICATED_TENANT_SLUG) {
      ctx.addIssue({
        code: "custom",
        path: ["DEDICATED_TENANT_SLUG"],
        message: "must not be set in shared mode",
      });
    }
  });

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "(root)")))];
    throw new ConfigError(names);
  }
  const v = parsed.data;
  return {
    mode: v.DEPLOYMENT_MODE,
    databaseUrl: v.DATABASE_URL,
    dedicatedTenantSlug: v.DEDICATED_TENANT_SLUG ?? null,
    jwt: {
      secret: new TextEncoder().encode(v.JWT_SECRET),
      issuer: v.JWT_ISSUER,
      audience: "whitelabel-api",
      accessTtlSeconds: v.ACCESS_TOKEN_TTL_SECONDS,
    },
    sessionTtlDays: v.REFRESH_SESSION_TTL_DAYS,
    passwordResetTtlMinutes: v.PASSWORD_RESET_TTL_MINUTES,
    trustProxy: v.TRUST_PROXY === "true",
    trustProxyHops: v.TRUST_PROXY_HOPS,
    logLevel: v.LOG_LEVEL,
    mailer: v.MAILER,
    maxBodyBytes: v.MAX_BODY_BYTES,
    nodeEnv: v.NODE_ENV,
  };
}
