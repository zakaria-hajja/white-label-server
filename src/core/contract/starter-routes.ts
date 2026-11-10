/**
 * The contract's route list: every `METHOD path` the starter serves under /api/v1. App backends
 * never edit it; their routes live under `APP_NAMESPACE`, which the starter never uses.
 * `tests/unit/contract/namespace.test.ts` fails when a route is added, removed or misplaced, so a
 * starter change has to update this list on purpose. See docs/contract.md.
 */
export const APP_NAMESPACE = "/api/v1/x/";

export const STARTER_ROUTES: readonly string[] = [
  "DELETE /api/v1/auth/sessions/{id}",
  "DELETE /api/v1/users/me",
  "GET /api/v1/app/config",
  "GET /api/v1/auth/me",
  "GET /api/v1/auth/sessions",
  "GET /api/v1/catalog",
  "GET /api/v1/catalog/{id}",
  "GET /api/v1/health",
  "GET /api/v1/openapi.json",
  "GET /api/v1/settings",
  "GET /api/v1/users/me",
  "PATCH /api/v1/settings",
  "PATCH /api/v1/users/me",
  "PATCH /api/v1/users/me/password",
  "POST /api/v1/auth/forgot-password",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/reset-password",
];

const pathOf = (key: string) => key.slice(key.indexOf(" ") + 1);
const inAppNamespace = (key: string) => pathOf(key).startsWith(APP_NAMESPACE);

/** Problems with the discovered route keys against the starter list; empty when all is well. */
export function checkRoutes(discovered: readonly string[], starter: readonly string[]): string[] {
  const listed = new Set(starter);
  const found = new Set(discovered);
  const problems: string[] = [];
  for (const key of starter) {
    if (inAppNamespace(key)) {
      problems.push(`${key}: STARTER_ROUTES must not list routes under ${APP_NAMESPACE}`);
    }
  }
  const unknown = discovered.filter((k) => !listed.has(k) && !inAppNamespace(k));
  if (unknown.length > 0) {
    problems.push(
      `Unlisted routes: ${unknown.join(", ")} — add starter routes to STARTER_ROUTES; app routes belong under ${APP_NAMESPACE}`,
    );
  }
  for (const key of starter) {
    if (!found.has(key)) problems.push(`${key}: stale STARTER_ROUTES entry (no such route)`);
  }
  return problems;
}
