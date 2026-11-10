# The API contract

This repo is the starter that every app's backend is created from (see
[creating-a-backend.md](./creating-a-backend.md)), and its API is what the shared Android features call
directly. Old Android builds stay installed on phones for months, so the contract may grow but must
never break an installed app. `/api/v1` is **extend-only**: a breaking change ships as `/api/v2`,
served alongside v1.

## What the contract is

- every path under `/api/v1` that the starter defines (listed in
  [`src/core/contract/starter-routes.ts`](../src/core/contract/starter-routes.ts));
- request and response schemas;
- the envelope (`{success, data, meta}` / `{success: false, error, meta}`);
- error codes and their HTTP statuses;
- headers: `Authorization`, `X-Client-Id`, `X-Request-Id`, `Retry-After`, and the `Cache-Control` and
  `Vary` headers of `GET /app/config`;
- pagination (`meta.pagination`);
- the starter flag keys (below).

The committed [`openapi/openapi.json`](../openapi/openapi.json) is its machine-readable form. Every
operation in it carries examples (success responses, request bodies, and the 400, 401 and 429 error
envelopes), computed from fixed fixtures by the real mappers, so they match what the server returns.

## What may change in v1

| Allowed in v1 (non-breaking) | Breaking: never in v1, ships as `/api/v2` |
| --- | --- |
| New endpoint or method | Removing or renaming an endpoint, method or path parameter |
| New optional request field | Making a request field required, or tightening its validation (length, format, enum) |
| New response field | Removing, renaming or retyping a response field, or making it nullable |
| New error code; a new enum value **in a response** only if clients degrade (error `code` does: unknown → `UNKNOWN`) | Removing or renaming an error code, or changing a code's status |
| New flag key | Changing a status code for an existing case; changing the envelope; removing a flag key's meaning |
| Loosening validation | Changing a header's meaning |

Renaming an `operationId` also breaks generated clients (it is the method name), and counts as
breaking.

## Tags and releases

Tags are `vMAJOR.MINOR.PATCH`:

- **MAJOR** equals the API path version: `v1.*` serves `/api/v1`.
- **MINOR** adds contract surface (a new endpoint, field, error code or flag key).
- **PATCH** has no contract change.

The owner cuts tags on `main`, each with a GitHub release whose notes list the contract additions and
any migration steps. Android pins a tag for its vendored `api/openapi.json`; each app's backend merges
tags. App backends fetch the starter's tags as `starter/v*`
([creating-a-backend.md](./creating-a-backend.md#1-create-the-repo)), so their own `v*` tags are free.

## v1 additions

Contract surface added after `v1.0.0`, by the tag that ships it:

| Tag | Addition |
| --- | --- |
| `v1.1.0` | `DELETE /api/v1/users/me` (`usersDeleteMe`): delete the account, confirmed with the password; shares the `password-check` rate limit with change-password (since the next tag; `v1.1.0` had a separate `delete-account` limit) |

## The app namespace: `/api/v1/x/`

The starter never defines routes under `/api/v1/x/`. App backends put all their own endpoints there
(`/api/v1/x/<feature>/…`), so a starter update can never collide with an app's routes. App endpoints
are part of that app's own contract, not the starter's.

## Deprecation

A v1 field or endpoint may be marked `deprecated: true` in the spec. It is never removed within v1.

## Starter flag keys

`GET /app/config` returns `features`, a key → boolean map. Unknown keys are off. The starter's keys
are exported as `STARTER_FEATURE_KEYS` from
[`src/modules/app-config/feature-keys.ts`](../src/modules/app-config/feature-keys.ts):

| Key | Meaning | Enforced by |
| --- | --- | --- |
| `catalog` | The catalog feature | the server: catalog routes return 404 `FEATURE_DISABLED` when off |
| `profile` | The profile screen | the client only: the server never gates `/users/me`, because sign-in and settings need it |

New tenants get both keys switched on, and `npm run db:seed` adds any key a seeded tenant is missing
without flipping existing values. The seed never runs in production: a tenant created before `profile`
existed doesn't have the key, so the client reads it as off. Operators switch it on once per such
tenant: `npm run tenant -- set-feature --slug <slug> --key profile --enabled true`. Home, settings and auth have no flag. Apps may add their own keys.

## CI guards

- **Breaking-change check.** On every pull request, CI compares the PR's `openapi/openapi.json` with
  the copy on the PR's base branch (`scripts/check-breaking.sh`, which runs `oasdiff` in breaking mode
  in a pinned container). For stacked PRs the base is the branch below, so each PR is checked against
  what it lands on. If the base has no spec yet (an app backend's first PR), the check passes with a
  notice; if the base ref can't be read at all, the step fails instead of skipping. The specs never
  leave the CI runner.
  - oasdiff rates some changes this policy treats as breaking as informational or warnings: removing a
    response enum value (such as an error code), an optional response field, a request field, a
    non-success status, a response header or an `operationId`, and changing a request pattern.
    `.oasdiff-levels.txt` raises them to errors.
  - oasdiff rates a new response enum value as an error. The script allows it for the error envelope's
    `code` only (clients map unknown codes to `UNKNOWN`) and prints the new codes; a new value in any
    other response enum, such as `theme`, still fails.
  - The check covers what the spec can express. A behaviour change with the same schema (a different
    status for the same case, a changed header meaning) is still caught only in review.
- **Namespace guard.** `tests/unit/contract/namespace.test.ts` keeps the starter's route list
  (`METHOD path`, so a new method on an existing path must be listed too). It fails when a route outside
  `x/` isn't listed, when a listed route no longer exists, or when the list contains an `x/` route. It
  allows unlisted `x/` routes, because it also runs in app backends; in the starter repo, a CI step
  fails if any file exists under `src/app/api/v1/x/`.
- **Spec drift.** CI regenerates the spec and fails on any diff, so the spec at a tag always matches the
  code at that tag.
- **Examples.** `tests/unit/openapi/examples.test.ts` parses every example with its schema and checks
  that each error example's code is one the operation can return. `tests/unit/openapi/dto-contract.test.ts`
  checks that each response example equals the real service output on the same fixture (token values,
  which are random, are swapped for the fixture's). Each 400 `VALIDATION_ERROR` example is compared with
  the real response of `route()` to that operation's `invalidExample`, so its `details` name a field
  the operation has. The health and other error examples are literals checked only by parsing.

## What Android depends on

- **Error codes by exact name** (the table in [api.md](./api.md#error-codes)). An unknown code maps to
  `UNKNOWN` on the client, which is why adding a code is non-breaking and removing or renaming one is
  breaking.
- **`X-Client-Id`** is optional on the client side, and its per-mode behaviour is part of the contract:
  required for unauthenticated calls in shared mode; in dedicated mode optional, but it must equal the
  deployment's slug when sent (see [api.md](./api.md#x-client-id-rules)).
- **The User-Agent is never parsed.** It is stored as the session's display label only.
