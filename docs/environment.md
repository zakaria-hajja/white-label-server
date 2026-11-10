# Environment variables

Configuration is read and validated once at startup (`src/core/config/env.ts`). Invalid or missing
values fail fast with an error that names the offending variables, never their values. For the optional
variables, an empty string (`VAR=`) is treated as unset, so the default applies. The required
variables (`DEPLOYMENT_MODE`, `DATABASE_URL`, `JWT_SECRET`) are not normalized: an empty value is
invalid.

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
| `TRUST_PROXY` | never | `false` | `true`, `false` | If `true`, client IP is taken from `X-Forwarded-For`, counting `TRUST_PROXY_HOPS` entries from the right (`X-Real-IP` is used only when `X-Forwarded-For` is absent). Enable only behind a proxy you control; otherwise the IP is unknown and IP-based rate limits are skipped. |
| `TRUST_PROXY_HOPS` | never | `1` | integer 1 to 20 | Only used when `TRUST_PROXY=true`. Number of proxies you control in front of the app (each appends one `X-Forwarded-For` entry). Entries left of that are client-supplied and ignored, so they cannot spoof the IP. Too few entries, or a non-IP entry, gives an unknown IP. See [deployment-shared.md](./deployment-shared.md#behind-a-proxy-trust_proxytrue). |
| `LOG_LEVEL` | never | `info` | non-empty string (pino level) | |
| `MAILER` | never | `console` | `console` | `console` logs reset links only when `NODE_ENV` is not `production`. |
| `MAX_BODY_BYTES` | never | `65536` | integer 1 to 10485760 (10 MiB) | Maximum request body size; values above 10 MiB are rejected at startup. |
| `NODE_ENV` | never | `development` | non-empty string | Set to `production` in production. |

## Tooling-only variables

Not read by the server (`src/core/config/env.ts` does not know them).

| Var | Used by | Default | Notes |
|---|---|---|---|
| `SHADOW_DATABASE_URL` | `prisma.config.ts`, for `prisma migrate diff --from-migrations` (the CI drift check) | unset | Points at an empty scratch database. CI uses `whitelabel_shadow`. |
| `API_PORT` | `docker-compose.yml` (`--profile app`) | `3000` | Host port mapped to the API container's port 3000. |
| `PORT`, `HOSTNAME` | the runtime image (`next start` / `server.js`) | `3000`, `0.0.0.0` | Set in the Dockerfile; the container always listens on 3000. |

The integration test projects set their own `DEPLOYMENT_MODE`, `DATABASE_URL` and `JWT_SECRET` in
`vitest.config.ts`; see [testing.md](./testing.md).

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
