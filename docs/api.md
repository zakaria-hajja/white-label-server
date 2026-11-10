# API guide

Base path `/api/v1`. The machine-readable contract is [`openapi/openapi.json`](../openapi/openapi.json)
(also served at `GET /api/v1/openapi.json`). This guide covers the behaviour that contract cannot express.
For how tenants and tokens work internally see [architecture.md](./architecture.md).

## Envelope

Every JSON response, including errors, uses one envelope and an `x-request-id` response header
(a valid incoming `x-request-id` is echoed, otherwise one is generated; quote it in bug reports).

```json
{ "success": true, "data": { }, "meta": { "requestId": "..." } }
{ "success": true, "data": [ ], "meta": { "requestId": "...", "pagination": { "page": 1, "pageSize": 20, "totalItems": 25, "totalPages": 2 } } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ { "path": "email", "message": "..." } ] }, "meta": { "requestId": "..." } }
```

`error.details` is present only for `VALIDATION_ERROR` (a list of `{path, message}`). Clients must branch on
`error.code`, never on `message`.

## Endpoints

| Method and path | Auth | `X-Client-Id` | Notes |
| --- | --- | --- | --- |
| `GET /health` | no | ignored | 200 `{status:"ok",db:"up"}`; 503 when the database is down (see below) |
| `GET /openapi.json` | no | ignored | the OpenAPI document |
| `GET /app/config` | no | see rules | public tenant config; cacheable |
| `POST /auth/register` | no | see rules | 201 `{user, tokens}`; 409 `EMAIL_ALREADY_REGISTERED` |
| `POST /auth/login` | no | see rules | 200 `{user, tokens}` |
| `POST /auth/refresh` | no | see rules | body `{refreshToken}`; 200 `{tokens}` |
| `POST /auth/logout` | no | see rules | body `{refreshToken}`; revokes the session; 200 `{}` even if the token is unknown |
| `POST /auth/forgot-password` | no | see rules | always 202 `{}` |
| `POST /auth/reset-password` | no | see rules | body `{token, newPassword}`; 200 `{}` |
| `GET /auth/me` | bearer | optional | `{user, tenant: {slug, name}, session: {id, expiresAt}}` |
| `GET /auth/sessions` | bearer | optional | `{sessions: [{id, userAgent, createdAt, lastUsedAt, current}]}` |
| `DELETE /auth/sessions/{id}` | bearer | optional | revoke one of your sessions |
| `GET /users/me`, `PATCH /users/me` | bearer | optional | profile; `firstName`/`lastName` are nullable |
| `PATCH /users/me/password` | bearer | optional | body `{currentPassword, newPassword}`; revokes your other sessions |
| `GET /settings`, `PATCH /settings` | bearer | optional | `theme` (`SYSTEM`, `LIGHT`, `DARK`), `language`, `notifications {push,email,marketing}` |
| `GET /catalog`, `GET /catalog/{id}` | bearer | optional | needs the `catalog` feature flag (else 404 `FEATURE_DISABLED`) |

Passwords are 10 to 128 characters (login accepts any non-empty value up to 128, so a wrong short password
yields `INVALID_CREDENTIALS`, not a validation error). Emails are trimmed and lowercased. Request bodies are
strict: unknown fields are rejected with `VALIDATION_ERROR`. Bodies over `MAX_BODY_BYTES` (default 65536)
give 413 `PAYLOAD_TOO_LARGE`.

## `X-Client-Id` rules

`X-Client-Id` carries the tenant slug. Rules depend on the deployment mode and on whether the endpoint
is authenticated (full decision table in [architecture.md](./architecture.md#tenant-resolution)).

| Endpoint type | Shared mode | Dedicated mode |
| --- | --- | --- |
| Unauthenticated tenant endpoints (`/app/config`, `/auth/register`, `login`, `refresh`, `logout`, `forgot-password`, `reset-password`) | Required; missing, malformed or unknown slug gives 400 `INVALID_CLIENT` | Optional; if sent it must equal the deployment's slug, else 400 `INVALID_CLIENT` |
| Authenticated endpoints (bearer token) | Optional; the tenant comes from the token, and a header that names another tenant gives 403 `TENANT_MISMATCH` | Optional; if sent it must equal the deployment's slug (400 `INVALID_CLIENT`); a token from another tenant gives 401 `UNAUTHENTICATED` |
| `/health`, `/openapi.json` | ignored | ignored |

A suspended tenant gets 403 `TENANT_SUSPENDED` everywhere tenant resolution applies; it takes effect on
running servers within 30 s. Feature flag and app-config changes made by the CLI are also cached for up
to 30 s per instance.

## Token lifecycle

Login and register return `tokens: {accessToken, refreshToken, tokenType: "Bearer", expiresIn}`.

- **Access token:** short-lived JWT (`expiresIn` seconds; default 900). Send `Authorization: Bearer <accessToken>`.
  Treat it as opaque; do not read claims on the client.
- **Refresh token:** opaque, single use, bound to a session. `POST /auth/refresh` returns a new pair and
  invalidates the old refresh token. The session has a fixed absolute lifetime (default 30 days from login;
  rotation does not extend it), after which the user must log in again.
- **Revocation is immediate:** logout, password change (other sessions), password reset, disabling the user
  or `DELETE /auth/sessions/{id}` make the next request with that session's access token fail with 401
  `UNAUTHENTICATED`, even before the token's `exp`.
- **Reuse detection:** presenting an already-used refresh token more than 10 s after it was used is treated
  as theft: 401 `INVALID_REFRESH_TOKEN` and the whole session is revoked. Within 10 s it is treated as a retry
  (see below) and the session survives. Therefore the Android client must **single-flight refresh**: only
  one refresh in flight at a time, with every concurrent 401 waiting on that one result.
- **Lost refresh responses.** If a refresh succeeded on the server but the response never reached the app
  (timeout, dropped connection, process death), retry once with the **old** token within 10 s: the server
  supersedes the pair it issued (which the app never saw) and returns a **fresh pair**. Only the last pair
  handed out works; a superseded refresh token gets 401 `INVALID_REFRESH_TOKEN` without revoking the session.
  A retry within 10 s gets 401 (session kept) if the new token from the first response was already used.
  Clients should therefore (a) persist the new pair atomically before using it, (b) never retry a refresh
  with a token already known to be accepted, (c) after an ambiguous failure make at most one retry with the
  old token, within 10 s, and if that returns `INVALID_REFRESH_TOKEN` send the user to sign in, and (d)
  never retry with the old token after 10 s (that revokes the session).
- Password reset links are valid `PASSWORD_RESET_TTL_MINUTES` (default 30), single use, and revoke all
  sessions.
- Repeated failed logins lock the account for 15 minutes after 10 failures; the response stays
  `INVALID_CREDENTIALS`.

## Android client guidance

1. Send `X-Client-Id: <slug>` on every request, in both modes. It is required for unauthenticated calls in
   shared mode, harmless in dedicated mode (and catches an app pointed at the wrong backend).
2. Send the bearer token on authenticated calls; keep access and refresh tokens in encrypted storage.
3. On 401 `TOKEN_EXPIRED`: refresh once (single flight), then retry the original request once. If the retry
   still fails with 401, sign out.
4. On 401 `UNAUTHENTICATED` for a request that had a token: the session was revoked or the user disabled;
   try one refresh, and if that fails, sign out.
5. On 401 `INVALID_REFRESH_TOKEN`: sign out and show the login screen. Do not retry. (The one exception
   is before that: when a refresh fails ambiguously, e.g. a timeout, retry it once with the old token
   within 10 s; that returns a fresh pair. Still single-flight: the retry is the one refresh in flight.)
6. On 429 `RATE_LIMITED`: read the `Retry-After` header (seconds), wait at least that long, and do not
   auto-retry in a tight loop. Back off on 5xx as well.
7. Branch on `error.code`; show your own localised text rather than `error.message`.
8. Use `GET /app/config` at start-up for display name, support and legal links, language and theme
   defaults, branding, feature flags and version hints. Mind the caching below. (The password-reset link
   base URL is server-side only: it is used to build the emailed link and is not in the response.)
9. Never treat `/health` as a JSON success check; see below.

## Health

`GET /health` returns 200 with `{"status":"ok","db":"up"}`. When the database is unreachable it returns
HTTP **503** but still with the success envelope: `{"success":true,"data":{"status":"degraded","db":"down"},...}`.
Probes and clients must use the HTTP status code (the Docker `HEALTHCHECK` does), not `success`.

## Pagination and catalog queries

`GET /catalog` query parameters:

| Param | Default | Rules |
| --- | --- | --- |
| `page` | 1 | integer >= 1 |
| `pageSize` | 20 | integer 1 to 100 |
| `q` | none | up to 100 chars; case-insensitive substring match on title or description; empty means no search |
| `category` | none | exact match, 1 to 50 chars |
| `sort` | `createdAt:desc` | one of `createdAt:asc`, `createdAt:desc`, `title:asc`, `title:desc` |

Unknown query parameters are rejected with `VALIDATION_ERROR`. The page is in `data` (array of
`{id, title, description, category, imageUrl, createdAt, updatedAt}`) and the counts in `meta.pagination`
(`page`, `pageSize`, `totalItems`, `totalPages`). A malformed or foreign `{id}` is 404 `NOT_FOUND`.

## Caching: `GET /app/config`

The response carries `Cache-Control: public, max-age=60` and `Vary: X-Client-Id`. In shared mode one URL
serves different tenants, so any CDN or proxy must key the cache on `X-Client-Id` (the `Vary` header says
so). Clients may reuse a response for 60 s; server-side the document is cached up to 30 s more per instance,
so config edits can take about 90 s to reach a client.

## Rate limits

Limits return 429 `RATE_LIMITED` with `Retry-After`. Rules (per instance, in memory) are listed in
[architecture.md](./architecture.md#authentication). IP-based rules apply only when the server runs with
`TRUST_PROXY=true` behind a proxy; see the deployment guides.

## Error codes

From `src/core/errors/codes.ts`.

| Code | HTTP | Meaning / client action |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body, query or params invalid; see `details`. Fix the request. |
| `INVALID_CLIENT` | 400 | `X-Client-Id` missing, malformed, unknown, or (dedicated) not this deployment's slug. |
| `INVALID_RESET_TOKEN` | 400 | Reset token unknown, expired or used. Ask for a new link. |
| `UNAUTHENTICATED` | 401 | Missing, malformed or invalid token; revoked or expired session; disabled user; token for another tenant (dedicated). |
| `TOKEN_EXPIRED` | 401 | Access token past `exp`. Refresh once, then retry. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password, or account locked or disabled (indistinguishable on purpose); also a wrong current password on password change. |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token unknown, used, expired or its session ended. Sign out. |
| `FORBIDDEN` | 403 | Reserved; no endpoint returns it today. |
| `TENANT_SUSPENDED` | 403 | The tenant is suspended. |
| `TENANT_MISMATCH` | 403 | Shared mode: `X-Client-Id` differs from the token's tenant. |
| `NOT_FOUND` | 404 | Unknown resource, malformed id, or another tenant's resource. |
| `FEATURE_DISABLED` | 404 | The tenant has the feature flag off (for example `catalog`). |
| `EMAIL_ALREADY_REGISTERED` | 409 | Registration with an existing email in this tenant. |
| `PAYLOAD_TOO_LARGE` | 413 | Body over `MAX_BODY_BYTES`. |
| `RATE_LIMITED` | 429 | Wait `Retry-After` seconds. |
| `INTERNAL_ERROR` | 500 | Unexpected; message is generic. Report the `requestId`. |

## Consuming the contract from the Android repo

The Android project treats this repository as the source of truth for the API and never hand-writes
request or response types.

1. Pin a version: reference a git tag (or a full commit SHA) of this repo, for example by adding it as a
   git submodule or by downloading the file at that ref:
   `https://raw.githubusercontent.com/<org>/<repo>/<tag>/openapi/openapi.json` (or a CI step that checks
   out the tag and copies `openapi/openapi.json`). Do not track `main`.
2. Generate the client from that file with your generator of choice (for example OpenAPI Generator's
   Kotlin or Retrofit generator, or Ktor/Moshi variants) in a Gradle task; do not commit the generated
   code unless your policy requires it.
3. `operationId`s are stable method names (`authLogin`, `authRefresh`, `catalogList`, `appConfigGet`, ...);
   renaming one is a breaking change for the client and must be treated as such in review.
4. Upgrade deliberately: bump the pinned tag, regenerate, fix compile errors, test. CI here fails if the
   committed spec drifts from the code (`npm run openapi:generate` must produce no diff), so a spec at a
   tag always matches the code at that tag.
5. Add the generated client's default headers: `X-Client-Id` (your tenant slug) and the bearer
   interceptor with single-flight refresh as described above.
