# Creating an app's backend

Every app built from `android-starter-kit` gets its own backend, created from this repo (the
**starter**). The app's backend is a separate repo that keeps a `starter` git remote, so starter fixes
and features arrive with a normal `git merge` of a starter tag. This guide is the counterpart of the
Android repo's `docs/creating-an-app.md`. The rules for what the starter may change are in
[contract.md](./contract.md).

The examples use an app called **showcase**. Replace `<owner>` with your GitHub account.

## 1. Create the repo

GitHub can't fork a repo into the account that owns it, so this is a clone, not a fork.

1. Create a new, **empty**, private repo on GitHub (no README, licence or `.gitignore`), for example
   `<owner>/showcase-backend`.
2. Clone the starter at the tag you want to start from, and turn it into the new repo:

   ```bash
   git clone --branch v1.0.0 https://github.com/<owner>/white-label-server.git showcase-backend
   cd showcase-backend
   git switch -c main                    # cloning a tag leaves a detached HEAD
   git remote rename origin starter      # the starter stays reachable as "starter"
   git remote add origin https://github.com/<owner>/showcase-backend.git
   git push -u origin main
   npm ci                                # also installs the git hooks
   ```

3. `git remote -v` now lists `origin` (your app's backend) and `starter` (this repo). Never push to
   `starter` from an app's backend.

## 2. Make it yours

1. Copy `.env.example` to `.env` and set the dedicated-mode values (all variables:
   [environment.md](./environment.md)):

   ```dotenv
   DEPLOYMENT_MODE=dedicated
   DEDICATED_TENANT_SLUG=showcase
   ```

   `DEDICATED_TENANT_SLUG` must equal the Android app's `api.tenant` when the app sets it. Otherwise it
   is any valid slug (2 to 63 lowercase letters, digits or hyphens).
2. Create the single tenant with the tenant CLI, with its config and flags. `create` switches on the
   starter flags (`catalog`, `profile`); switch off the ones the app doesn't use:

   ```bash
   npm run tenant -- create --slug showcase --name "Showcase" --config showcase-config.json
   npm run tenant -- set-feature --slug showcase --key catalog --enabled false
   ```

   The config JSON is validated against the app-config schema (display name, support, legal links,
   `passwordReset.linkBaseUrl`, runtime defaults, branding). See
   [deployment-dedicated.md](./deployment-dedicated.md#provisioning-a-new-deployment).
3. For local development, `npm run db:seed` in dedicated mode seeds only `DEDICATED_TENANT_SLUG`, with
   demo users and 25 demo catalog items. Keep the catalog module if the app shows a catalog. If it
   doesn't, switch its flag off; don't delete the module's files, because they are starter files and
   deleting them makes every later starter merge conflict.

## 3. Line it up with the Android app

| Android `app.properties` | Backend |
| --- | --- |
| `api.release.baseUrl` | the deployment's public URL + `/api/v1/` |
| `api.debug.baseUrl` | the local dev URL, e.g. `http://10.0.2.2:3000/api/v1/` from the emulator |
| `api.tenant` | `DEDICATED_TENANT_SLUG`, or the tenant slug in shared mode |
| `defaults.features` | the flag keys set for the tenant (`catalog`, `profile`, plus your own) |
| `defaults.legal.*` / `defaults.support.email` | the tenant's app config (`legal`, `support`) |

## 4. Add app-specific features

Follow [adding-a-module.md](./adding-a-module.md), with three rules that keep starter merges clean:

1. **App endpoints live under `/api/v1/x/<feature>/…`.** The starter never defines routes there, so a
   starter update can't collide with yours. The namespace test allows any route under `x/` without
   listing it.
2. **App code lives in new folders:** `src/modules/<feature>/` and `src/app/api/v1/x/<feature>/`.
3. **Starter files are touched only at the extension points:**
   - container wiring (`src/core/container.ts`);
   - the OpenAPI registration list (`src/core/openapi/document.ts`);
   - seed data (`prisma/seed-data.ts`);
   - `.env`;
   - the isolation-matrix rows for the new routes (`tests/integration/security/isolation.test.ts`).

   New Prisma models go in `prisma/schema.prisma` with their own migration; that file is shared, so
   add your models at the end of it.

Changing a starter route (anything outside `x/`) in an app's backend forks the contract that every
Android build relies on. Don't: propose the change to the starter instead.

## 5. Pull starter updates

1. Read the starter's release notes (the GitHub release text of each tag) for migration steps.
2. Merge the tag:

   ```bash
   git fetch starter --tags
   git switch -c chore/starter-v1.1.0
   git merge v1.1.0
   ```

3. **Generated files: never hand-merge them.** `openapi/openapi.json` is generated, so it **will**
   conflict whenever the app has its own routes. Take either side and regenerate, then commit:

   ```bash
   git checkout --theirs openapi/openapi.json && npm run openapi:generate
   git add openapi/openapi.json
   ```

   The same rule applies to `package-lock.json`: take either side, run `npm install`, and commit the
   result.
4. Run the full suite (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`), then open a
   PR. The breaking-change check runs in the app's own CI against the app's base branch, so it also
   catches a starter update that changed something the app's Android build relies on.

## 6. Deploy

See [deployment-dedicated.md](./deployment-dedicated.md). Several small apps can also share one
deployment in shared mode; see [deployment-shared.md](./deployment-shared.md#when-to-choose-shared-mode).
