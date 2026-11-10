import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testPrisma } from "../../helpers/db";
import { loginAs, seedTwoTenants, type Login } from "../../helpers/actors";
import { SEED_PASSWORD } from "../../../prisma/seed-data";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { GET as authMe } from "@/app/api/v1/auth/me/route";
import { GET as listSessions } from "@/app/api/v1/auth/sessions/route";
import { DELETE as deleteSession } from "@/app/api/v1/auth/sessions/[id]/route";
import { DELETE as deleteMe, GET as getMe, PATCH as patchMe } from "@/app/api/v1/users/me/route";
import { PATCH as patchPassword } from "@/app/api/v1/users/me/password/route";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/v1/settings/route";
import { GET as listCatalog } from "@/app/api/v1/catalog/route";
import { GET as getCatalog } from "@/app/api/v1/catalog/[id]/route";
import { GET as appConfig } from "@/app/api/v1/app/config/route";
import { GET as health } from "@/app/api/v1/health/route";

const config = loadConfig(process.env);
const FORBIDDEN = [
  "passwordHash",
  "tokenHash",
  "stack",
  "prisma",
  "$argon2",
  process.env.JWT_SECRET ?? "<unset-jwt-secret>",
  process.env.DATABASE_URL ?? "<unset-database-url>",
];
const noParams = { params: Promise.resolve({}) };
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

let seen = 0;
let errors = 0;
/** Records a response: checks the body for forbidden substrings and error cache headers. */
async function rec(res: Response, expectedStatus?: number): Promise<Response> {
  const text = await res.clone().text();
  for (const bad of FORBIDDEN) expect(text, `body contains "${bad}"`).not.toContain(bad);
  if (res.status >= 400) {
    errors++;
    expect(res.headers.get("cache-control") ?? "").not.toMatch(/public/i);
  }
  if (expectedStatus !== undefined) expect(res.status, text).toBe(expectedStatus);
  seen++;
  return res;
}

type Opts = { token?: string; client?: string | null; body?: unknown; raw?: string };
function req(method: string, url: string, o: Opts = {}) {
  const client = o.client === undefined ? "acme" : o.client;
  return new Request(`http://localhost/api/v1/${url}`, {
    method,
    ...(o.raw !== undefined
      ? { body: o.raw }
      : o.body === undefined
        ? {}
        : { body: JSON.stringify(o.body) }),
    headers: {
      "content-type": "application/json",
      ...(client ? { "x-client-id": client } : {}),
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
  });
}

let alice: Login;
let catalogId: string;
beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  const { acme } = await seedTwoTenants();
  catalogId = acme.catalogIds[0] ?? "";
  alice = await loginAs("acme", "alice@shared.test");
  seen = 0;
  errors = 0;
});

describe("response leakage", () => {
  it("success paths of every endpoint leak nothing", async () => {
    const t = alice.accessToken;
    await rec(
      await register(
        req("POST", "auth/register", { body: { email: "new@x.co", password: "correct-horse-1" } }),
        noParams,
      ),
      201,
    );
    await rec(
      await login(
        req("POST", "auth/login", { body: { email: "bob@shared.test", password: SEED_PASSWORD } }),
        noParams,
      ),
      200,
    );
    await rec(
      await forgotPassword(
        req("POST", "auth/forgot-password", { body: { email: "alice@shared.test" } }),
        noParams,
      ),
      202,
    );
    await rec(
      await forgotPassword(
        req("POST", "auth/forgot-password", { body: { email: "nobody@shared.test" } }),
        noParams,
      ),
      202,
    );
    await rec(await authMe(req("GET", "auth/me", { token: t }), noParams), 200);
    await rec(await listSessions(req("GET", "auth/sessions", { token: t }), noParams), 200);
    await rec(await getMe(req("GET", "users/me", { token: t }), noParams), 200);
    await rec(
      await patchMe(req("PATCH", "users/me", { token: t, body: { firstName: "Al" } }), noParams),
      200,
    );
    await rec(await getSettings(req("GET", "settings", { token: t }), noParams), 200);
    await rec(
      await patchSettings(
        req("PATCH", "settings", { token: t, body: { theme: "LIGHT" } }),
        noParams,
      ),
      200,
    );
    await rec(await listCatalog(req("GET", "catalog", { token: t }), noParams), 200);
    await rec(
      await getCatalog(req("GET", `catalog/${catalogId}`, { token: t }), idParams(catalogId)),
      200,
    );
    await rec(await appConfig(req("GET", "app/config"), noParams), 200);
    await rec(await health(req("GET", "health", { client: null }), noParams), 200);
    await rec(
      await refresh(
        req("POST", "auth/refresh", { body: { refreshToken: alice.refreshToken } }),
        noParams,
      ),
      200,
    );
    await rec(
      await patchPassword(
        req("PATCH", "users/me/password", {
          token: t,
          body: { currentPassword: SEED_PASSWORD, newPassword: "another-pass-9" },
        }),
        noParams,
      ),
      200,
    );
    await rec(
      await logout(req("POST", "auth/logout", { body: { refreshToken: "whatever" } }), noParams),
      200,
    );
    await rec(
      await deleteSession(
        req("DELETE", `auth/sessions/${alice.sessionId}`, { token: t }),
        idParams(alice.sessionId),
      ),
      200,
    );
    // Last: deletes an account (bob's, so alice's calls above are unaffected).
    const bob = await loginAs("acme", "bob@shared.test");
    await rec(
      await deleteMe(
        req("DELETE", "users/me", { token: bob.accessToken, body: { password: SEED_PASSWORD } }),
        noParams,
      ),
      200,
    );
    expect(seen).toBeGreaterThanOrEqual(19);
  });

  it("error paths of every endpoint leak nothing and are never publicly cacheable", async () => {
    const t = alice.accessToken;
    const bad = "00000000-0000-4000-8000-000000000000";
    await rec(
      await register(
        req("POST", "auth/register", {
          body: { email: "alice@shared.test", password: "correct-horse-1" },
        }),
        noParams,
      ),
      409,
    );
    await rec(
      await register(
        req("POST", "auth/register", { body: { email: "nope", password: "x" } }),
        noParams,
      ),
      400,
    );
    await rec(await register(req("POST", "auth/register", { raw: "{not json" }), noParams), 400);
    await rec(
      await login(
        req("POST", "auth/login", {
          body: { email: "alice@shared.test", password: "wrong-password" },
        }),
        noParams,
      ),
      401,
    );
    await rec(
      await login(
        req("POST", "auth/login", {
          body: { email: "ghost@shared.test", password: "wrong-password" },
        }),
        noParams,
      ),
      401,
    );
    await rec(
      await refresh(req("POST", "auth/refresh", { body: { refreshToken: "nope" } }), noParams),
      401,
    );
    await rec(
      await resetPassword(
        req("POST", "auth/reset-password", {
          body: { token: "nope", newPassword: "another-pass-9" },
        }),
        noParams,
      ),
      400,
    );
    await rec(await authMe(req("GET", "auth/me"), noParams), 401);
    await rec(await authMe(req("GET", "auth/me", { token: "garbage" }), noParams), 401);
    await rec(await authMe(req("GET", "auth/me", { token: t, client: "globex" }), noParams), 403);
    await rec(
      await forgotPassword(
        req("POST", "auth/forgot-password", { client: null, body: { email: "a@x.co" } }),
        noParams,
      ),
      400,
    );
    await rec(await getMe(req("GET", "users/me", { client: "no-such-tenant" }), noParams), 401);
    await rec(
      await patchMe(req("PATCH", "users/me", { token: t, body: { status: "DISABLED" } }), noParams),
      400,
    );
    await rec(
      await patchPassword(
        req("PATCH", "users/me/password", {
          token: t,
          body: { currentPassword: "wrong-password", newPassword: "another-pass-9" },
        }),
        noParams,
      ),
      401,
    );
    await rec(
      await patchSettings(
        req("PATCH", "settings", { token: t, body: { language: "xx" } }),
        noParams,
      ),
      400,
    );
    await rec(await getCatalog(req("GET", `catalog/${bad}`, { token: t }), idParams(bad)), 404);
    await rec(
      await getCatalog(req("GET", "catalog/not-a-uuid", { token: t }), idParams("not-a-uuid")),
      404,
    );
    await rec(await listCatalog(req("GET", "catalog?page=-1", { token: t }), noParams), 400);
    await rec(
      await deleteSession(req("DELETE", `auth/sessions/${bad}`, { token: t }), idParams(bad)),
      404,
    );
    await rec(
      await deleteMe(
        req("DELETE", "users/me", { token: t, body: { password: "wrong-password" } }),
        noParams,
      ),
      401,
    );
    await rec(await deleteMe(req("DELETE", "users/me", { token: t, raw: "" }), noParams), 400);
    await rec(
      await appConfig(req("GET", "app/config", { client: "no-such-tenant" }), noParams),
      400,
    );
    expect(errors).toBeGreaterThanOrEqual(20);
  });

  it("a forced 500 (missing ApplicationConfiguration row) is generic and not cacheable", async () => {
    const acme = await testPrisma().tenant.findUniqueOrThrow({ where: { slug: "acme" } });
    await testPrisma().applicationConfiguration.delete({ where: { tenantId: acme.id } });
    // Fresh container: the app-config cache must not hide the missing row.
    setContainer(createContainer(config, { prisma: testPrisma() }));
    const res = await rec(await appConfig(req("GET", "app/config"), noParams), 500);
    const text = await res.clone().text();
    const body = JSON.parse(text) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    // The thrown error says "application configuration missing for tenant <id>"; none of it may leak.
    expect(body.error.message).toBe("An unexpected error occurred");
    expect(body.error).not.toHaveProperty("details");
    expect(text).not.toContain("application configuration");
    expect(text).not.toContain(acme.id);
    expect(text).not.toContain("    at ");
    expect(res.headers.get("cache-control") ?? "").not.toMatch(/public/i);
  });

  it("a degraded health check (database error carrying the URL) does not echo the error", async () => {
    const boom = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error(`connect failed ${process.env.DATABASE_URL} $argon2 stack prisma`);
        },
      },
    );
    setContainer(createContainer(config, { prisma: boom as never }));
    await rec(await health(req("GET", "health", { client: null }), noParams), 503);
  });
});
