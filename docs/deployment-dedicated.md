# Dedicated deployment

One deployment serves exactly one tenant, with its own database, `JWT_SECRET`, domain and release cadence.
The image is the same as for [shared](./deployment-shared.md); only the environment differs. Most of the
operational guidance there applies unchanged: this page lists what differs and links the rest.

## Configuration

```dotenv
DEPLOYMENT_MODE=dedicated
DEDICATED_TENANT_SLUG=acme
DATABASE_URL=postgresql://APP_USER:PASSWORD@HOST:5432/whitelabel_acme?sslmode=require
JWT_SECRET=<a different random string per deployment, at least 32 characters>
NODE_ENV=production
TRUST_PROXY=true
```

All variables: [environment.md](./environment.md). `DEDICATED_TENANT_SLUG` is required in this mode, and the
tenant must already exist in the database: the server loads it at startup and exits 1 if it is missing.
Never reuse a `JWT_SECRET` or database between deployments; tokens carry the tenant id, and a token from
another tenant is rejected with 401 `UNAUTHENTICATED`.

## Provisioning a new deployment

1. Create an empty database (with the two roles from the
   [least-privilege recipe](./deployment-shared.md#database), substituting this deployment's database name) and a unique `JWT_SECRET`.
2. Build the images (`docker build -t whitelabel-api .` and
   `docker build --target migrator -t whitelabel-api-migrator .`) and run the migrator against the new
   database: `docker run --rm -e DATABASE_URL=<owner-role URL> whitelabel-api-migrator`.
3. Create the single tenant with the CLI, using the **same slug** as `DEDICATED_TENANT_SLUG`. The CLI is not
   in the images: run it from a source checkout of the same release tag (`git checkout <tag> && npm ci`) on
   a trusted admin machine or one-off job, with the deployment's variables exported (it requires
   `DEPLOYMENT_MODE`, `JWT_SECRET` and, in dedicated mode, `DEDICATED_TENANT_SLUG`) and a TLS
   `DATABASE_URL`; details in [deployment-shared.md](./deployment-shared.md#onboarding-a-tenant):

   ```bash
   git checkout <release-tag> && npm ci
   export DEPLOYMENT_MODE=dedicated DEDICATED_TENANT_SLUG=acme JWT_SECRET=<the deployment secret> \
     DATABASE_URL='postgresql://APP_USER:PASSWORD@HOST:5432/whitelabel_acme?sslmode=require'
   npm run tenant -- create --slug acme --name "Acme" --config acme-config.json
   ```

   Set the display name, support and legal links and `passwordReset.linkBaseUrl` in the config JSON (or
   later with `set-config`), and toggle features with `set-feature`.
4. Start the app container with the environment above, point DNS (for example `api.acme.com`) and TLS at it,
   and check `GET /api/v1/health`.
5. Ship the Android build with that base URL. Sending `X-Client-Id: acme` is optional; if sent it must equal
   the slug, otherwise 400 `INVALID_CLIENT` (this catches an app pointed at the wrong backend).

Do not run `npm run db:seed` in production (it refuses when `NODE_ENV=production`); it is for local data.

## Every release

Same as shared: run the migrator for each deployment's database before rolling its app
([deployment-shared.md](./deployment-shared.md#every-rollout)). With many deployments, script the loop over
deployments and stop on the first failure. Deployments may run different versions; keep API changes
backward compatible because Android apps pin the OpenAPI contract by tag ([api.md](./api.md)).

## Same as shared

- `TRUST_PROXY=true` behind a proxy that overwrites `X-Forwarded-For`; without it IP rate limits are skipped.
- Rate limits are per instance; swap in Redis behind `RateLimiter` if you run several instances.
- Secret rotation: rotating `JWT_SECRET` invalidates all access tokens of this deployment only.
- Database TLS (`sslmode=require`) and least-privilege roles.
- Suspension: `npm run tenant -- set-status --slug acme --status SUSPENDED` takes effect within 30 s (403
  `TENANT_SUSPENDED`).
- Before adding a real mail provider (async sending, console mailer suppresses links in production):
  [deployment-shared.md](./deployment-shared.md#before-adding-a-real-mail-provider).
