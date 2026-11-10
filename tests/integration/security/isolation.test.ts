import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { discoverRoutes } from "../../helpers/routes";
import { loginAs, seedTwoTenants, type Login, type TenantActors } from "../../helpers/actors";
import { signAccessToken } from "@/core/auth/jwt";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { GET as authMe } from "@/app/api/v1/auth/me/route";
import { GET as listSessions } from "@/app/api/v1/auth/sessions/route";
import { DELETE as deleteSession } from "@/app/api/v1/auth/sessions/[id]/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/users/me/route";
import { PATCH as patchPassword } from "@/app/api/v1/users/me/password/route";
import { SEED_PASSWORD } from "../../../prisma/seed-data";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/v1/settings/route";
import { GET as listCatalog } from "@/app/api/v1/catalog/route";
import { GET as getCatalog } from "@/app/api/v1/catalog/[id]/route";

const config = loadConfig(process.env);

type World = {
  acme: TenantActors;
  globex: TenantActors;
  acmeAlice: Login;
  globexAlice: Login;
};
type Call = { token: string; client?: string };
type Owned = { model: "user" | "session" | "catalogItem"; ids: string[] };

function request(method: string, url: string, { token, client }: Call, body?: unknown) {
  return new Request(`http://localhost/api/v1/${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(client ? { "x-client-id": client } : {}),
    },
  });
}
const noParams = { params: Promise.resolve({}) };
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * One row per authenticated endpoint. Adding a module means adding a row here: the loops below
 * generate the TENANT_MISMATCH and acme-only-data tests for it.
 */
type Row = {
  name: string;
  invoke: (c: Call, w: World) => Promise<Response>;
  /** Ids in the response body that must all be rows of the calling tenant. */
  owned?: (data: unknown) => Owned;
  /** Password-hash guard: `own` is the caller's user id, `others` must never change. */
  hashes?: (w: World) => { own: string; others: string[] };
};

const hashOf = async (id: string) =>
  (await testPrisma().user.findUniqueOrThrow({ where: { id } })).passwordHash;

const asObj = (d: unknown) => d as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROWS: Row[] = [
  {
    name: "GET auth/me",
    invoke: (c) => authMe(request("GET", "auth/me", c), noParams),
    owned: (d) => ({ model: "user", ids: [asObj(d).user.id] }),
  },
  {
    name: "GET auth/sessions",
    invoke: (c) => listSessions(request("GET", "auth/sessions", c), noParams),
    owned: (d) => ({ model: "session", ids: asObj(d).sessions.map((s: { id: string }) => s.id) }),
  },
  {
    name: "DELETE auth/sessions/{id}",
    invoke: (c, w) =>
      deleteSession(
        request("DELETE", `auth/sessions/${w.acmeAlice.sessionId}`, c),
        idParams(w.acmeAlice.sessionId),
      ),
  },
  {
    name: "GET users/me",
    invoke: (c) => getMe(request("GET", "users/me", c), noParams),
    owned: (d) => ({ model: "user", ids: [asObj(d).id] }),
  },
  {
    name: "PATCH users/me",
    invoke: (c) => patchMe(request("PATCH", "users/me", c, { firstName: "Patched" }), noParams),
    owned: (d) => ({ model: "user", ids: [asObj(d).id] }),
  },
  {
    name: "PATCH users/me/password",
    invoke: (c) =>
      patchPassword(
        request("PATCH", "users/me/password", c, {
          currentPassword: SEED_PASSWORD,
          newPassword: "another-pass-9",
        }),
        noParams,
      ),
    // Only the caller's own hash may change; the same-email user in the other tenant never does.
    hashes: (w) => ({
      own: w.acme.aliceId,
      others: [w.globex.aliceId, w.globex.bobId, w.acme.bobId],
    }),
  },
  {
    name: "GET settings",
    invoke: (c) => getSettings(request("GET", "settings", c), noParams),
  },
  {
    name: "PATCH settings",
    invoke: (c) => patchSettings(request("PATCH", "settings", c, { theme: "LIGHT" }), noParams),
  },
  {
    name: "GET catalog",
    invoke: (c) => listCatalog(request("GET", "catalog?pageSize=100", c), noParams),
    owned: (d) => ({ model: "catalogItem", ids: (d as { id: string }[]).map((i) => i.id) }),
  },
  {
    name: "GET catalog/{id}",
    invoke: (c, w) => {
      const id = w.acme.catalogIds[0] ?? "";
      return getCatalog(request("GET", `catalog/${id}`, c), idParams(id));
    },
    owned: (d) => ({ model: "catalogItem", ids: [asObj(d).id] }),
  },
];

/** Operations addressed by an id of ANOTHER tenant's row: always 404, and the row is untouched. */
const CROSS_ROWS: {
  name: string;
  /** The operation exercised, as `METHOD /api/v1/path` (checked by the completeness test). */
  route: string;
  invoke: (c: Call, w: World) => Promise<Response>;
}[] = [
  {
    name: "GET catalog/{globex item id}",
    route: "GET /api/v1/catalog/{id}",
    invoke: (c, w) => {
      const id = w.globex.catalogIds[0] ?? "";
      return getCatalog(request("GET", `catalog/${id}`, c), idParams(id));
    },
  },
  {
    name: "DELETE auth/sessions/{globex session id}",
    route: "DELETE /api/v1/auth/sessions/{id}",
    invoke: (c, w) =>
      deleteSession(
        request("DELETE", `auth/sessions/${w.globexAlice.sessionId}`, c),
        idParams(w.globexAlice.sessionId),
      ),
  },
];

/**
 * Tenant-required routes that are deliberately NOT in the matrix: they are public (no access token),
 * so there is no token tenant to mismatch. Their tenant scoping is covered elsewhere:
 * app/config in tests/integration/app-config, auth in tests/integration/auth and the refresh
 * cross-tenant test at the end of this file.
 */
const PUBLIC_TENANT_ROUTES = new Set([
  "GET /api/v1/app/config",
  "POST /api/v1/auth/register",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/forgot-password",
  "POST /api/v1/auth/reset-password",
]);

/** "GET auth/me" -> "GET /api/v1/auth/me" */
const rowRoute = (name: string) => name.replace(" ", " /api/v1/");

describe("tenant isolation matrix completeness", () => {
  it("covers every tenant-required route with a ROWS or CROSS_ROWS entry", async () => {
    const covered = new Set([
      ...ROWS.map((r) => rowRoute(r.name)),
      ...CROSS_ROWS.map((r) => r.route),
    ]);
    const missing = (await discoverRoutes())
      .filter((r) => r.handler.meta.tenant === "required" && !PUBLIC_TENANT_ROUTES.has(r.key))
      .map((r) => r.key)
      .filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it("has no stale entries (every row and allowlisted route exists)", async () => {
    const existing = new Set((await discoverRoutes()).map((r) => r.key));
    const named = [
      ...ROWS.map((r) => rowRoute(r.name)),
      ...CROSS_ROWS.map((r) => r.route),
      ...PUBLIC_TENANT_ROUTES,
    ];
    expect(named.filter((k) => !existing.has(k))).toEqual([]);
  });

  it("allowlists only public routes", async () => {
    const authed = (await discoverRoutes()).filter(
      (r) => PUBLIC_TENANT_ROUTES.has(r.key) && r.handler.meta.auth !== "none",
    );
    expect(authed.map((r) => r.key)).toEqual([]);
  });
});

let w: World;
beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  const { acme, globex } = await seedTwoTenants();
  w = {
    acme,
    globex,
    acmeAlice: await loginAs("acme", "alice@shared.test"),
    globexAlice: await loginAs("globex", "alice@shared.test"),
  };
});

describe("tenant isolation matrix", () => {
  describe.each(ROWS)("$name", (row) => {
    it("acme token + X-Client-Id globex -> 403 TENANT_MISMATCH", async () => {
      const g = row.hashes?.(w);
      const ids = g ? [g.own, ...g.others] : [];
      const before = await Promise.all(ids.map(hashOf));
      const res = await row.invoke({ token: w.acmeAlice.accessToken, client: "globex" }, w);
      expect(res.status).toBe(403);
      expect((await envelope(res)).error?.code).toBe("TENANT_MISMATCH");
      expect(await Promise.all(ids.map(hashOf))).toEqual(before);
    });

    it("acme token alone only returns acme data", async () => {
      const g = row.hashes?.(w);
      const ownBefore = g ? await hashOf(g.own) : "";
      const othersBefore = g ? await Promise.all(g.others.map(hashOf)) : [];
      const res = await row.invoke({ token: w.acmeAlice.accessToken }, w);
      expect(res.status).toBe(200);
      if (g) {
        expect(await hashOf(g.own)).not.toBe(ownBefore);
        expect(await Promise.all(g.others.map(hashOf))).toEqual(othersBefore);
      }
      if (!row.owned) return;
      const { model, ids } = row.owned((await envelope(res)).data ?? (await res.clone().json()));
      expect(ids.length).toBeGreaterThan(0);
      const rows = await (testPrisma()[model] as any).findMany({ where: { id: { in: ids } } }); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(rows).toHaveLength(ids.length);
      for (const r of rows) expect(r.tenantId).toBe(w.acme.id);
    });
  });

  describe.each(CROSS_ROWS)("$name", (row) => {
    it("is 404 NOT_FOUND for an acme token and leaves globex untouched", async () => {
      const res = await row.invoke({ token: w.acmeAlice.accessToken }, w);
      expect(res.status).toBe(404);
      expect((await envelope(res)).error?.code).toBe("NOT_FOUND");
      const session = await testPrisma().session.findUniqueOrThrow({
        where: { id: w.globexAlice.sessionId },
      });
      expect(session.revokedAt).toBeNull();
    });
  });

  it("catalog list returns exactly acme's 25 rows although globex shares titles", async () => {
    const res = await ROWS.find((r) => r.name === "GET catalog")!.invoke(
      { token: w.acmeAlice.accessToken },
      w,
    );
    const ids = ((await envelope(res)).data as unknown as { id: string }[]).map((i) => i.id);
    expect(ids.sort()).toEqual([...w.acme.catalogIds].sort());
    expect(ids.some((id) => w.globex.catalogIds.includes(id))).toBe(false);
  });

  it("acme alice's PATCH users/me does not change globex alice", async () => {
    const res = await patchMe(
      request("PATCH", "users/me", { token: w.acmeAlice.accessToken }, { firstName: "Mallory" }),
      noParams,
    );
    expect(res.status).toBe(200);
    const prisma = testPrisma();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.acme.aliceId } })).firstName).toBe(
      "Mallory",
    );
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: w.globex.aliceId } })).firstName,
    ).toBe("Alice");
  });

  it("acme alice's PATCH settings writes no globex settings", async () => {
    await patchSettings(
      request("PATCH", "settings", { token: w.acmeAlice.accessToken }, { theme: "LIGHT" }),
      noParams,
    );
    const prisma = testPrisma();
    expect(await prisma.userSettings.count({ where: { tenantId: w.acme.id } })).toBe(1);
    expect(await prisma.userSettings.count({ where: { tenantId: w.globex.id } })).toBe(0);
  });

  it("a globex refresh token with the acme header -> 401 and the token stays usable for globex", async () => {
    const res = await refresh(
      new Request("http://localhost/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: w.globexAlice.refreshToken }),
        headers: { "content-type": "application/json", "x-client-id": "acme" },
      }),
      noParams,
    );
    expect(res.status).toBe(401);
    const ok = await refresh(
      new Request("http://localhost/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: w.globexAlice.refreshToken }),
        headers: { "content-type": "application/json", "x-client-id": "globex" },
      }),
      noParams,
    );
    expect(ok.status).toBe(200);
  });

  it("a JWT with tid swapped to globex (real secret, acme sid) -> 401", async () => {
    const forged = await signAccessToken(
      config.jwt,
      { sub: w.acme.aliceId, tid: w.globex.id, sid: w.acmeAlice.sessionId },
      new Date(),
    );
    const res = await getMe(request("GET", "users/me", { token: forged }), noParams);
    expect(res.status).toBe(401);
  });

  it("a JWT {sub: globex user, tid: acme, sid: globex session} -> 401 (session tenant predicate)", async () => {
    const forged = await signAccessToken(
      config.jwt,
      { sub: w.globexAlice.userId, tid: w.acme.id, sid: w.globexAlice.sessionId },
      new Date(),
    );
    const res = await getMe(request("GET", "users/me", { token: forged }), noParams);
    expect(res.status).toBe(401);
    // Sanity: the same claims with globex's own tenant id are accepted, so only tid made it fail.
    const genuine = await signAccessToken(
      config.jwt,
      { sub: w.globexAlice.userId, tid: w.globex.id, sid: w.globexAlice.sessionId },
      new Date(),
    );
    expect((await getMe(request("GET", "users/me", { token: genuine }), noParams)).status).toBe(
      200,
    );
  });
});
