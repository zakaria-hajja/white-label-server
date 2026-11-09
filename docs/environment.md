# Environment variables

Configuration is read and validated once at startup (`src/core/config/env.ts`). Invalid or missing
values fail fast with an error that names the offending variables, never their values. An empty
string (`VAR=`) is treated as unset, so the default applies.

| Var | Required when | Default | Allowed values / range | Notes |
|---|---|---|---|---|
| `DEPLOYMENT_MODE` | always | none | `shared`, `dedicated` | Shared: one instance serves many tenants via `X-Client-Id`. Dedicated: one tenant. |
| `DATABASE_URL` | always | none | non-empty string | Use `sslmode=require` in production. |
| `DEDICATED_TENANT_SLUG` | `DEPLOYMENT_MODE=dedicated` | none | non-empty string | Must exist in the DB at startup. Must NOT be set in shared mode (startup fails). |
| `JWT_SECRET` | always | none | at least 32 characters | Unique per deployment. Never commit a real value. |
| `JWT_ISSUER` | never | `whitelabel-api` | non-empty string | |
| `ACCESS_TOKEN_TTL_SECONDS` | never | `900` | integer 60 to 3600 | |
| `REFRESH_SESSION_TTL_DAYS` | never | `30` | integer 1 to 365 | |
| `PASSWORD_RESET_TTL_MINUTES` | never | `30` | integer 5 to 1440 | |
| `TRUST_PROXY` | never | `false` | `true`, `false` | If `true`, client IP is taken from the first `X-Forwarded-For` hop. Enable only behind a trusted proxy. |
| `LOG_LEVEL` | never | `info` | non-empty string (pino level) | |
| `MAILER` | never | `console` | `console` | `console` logs reset links only when `NODE_ENV` is not `production`. |
| `MAX_BODY_BYTES` | never | `65536` | integer 1 to 10485760 (10 MiB) | Maximum request body size; values above 10 MiB are rejected at startup. |
| `NODE_ENV` | never | `development` | non-empty string | Set to `production` in production. |

## Examples

Shared deployment (many tenants, selected per request by `X-Client-Id`):

```dotenv
DEPLOYMENT_MODE=shared
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/whitelabel?sslmode=require
JWT_SECRET=<random string, at least 32 characters>
```

Dedicated deployment (one tenant per instance):

```dotenv
DEPLOYMENT_MODE=dedicated
DEDICATED_TENANT_SLUG=acme
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/whitelabel_acme?sslmode=require
JWT_SECRET=<a different random string, at least 32 characters>
```
