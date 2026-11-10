import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { loginAs, seedTwoTenants, type Login } from "../../helpers/actors";
import { SEED_PASSWORD } from "../../../prisma/seed-data";
import { loadConfig } from "@/core/config/env";
import { createContainer, getContainer, setContainer } from "@/core/container";
import { TenantAdminService } from "@/core/tenant/tenant-admin.service";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { GET as getMe } from "@/app/api/v1/users/me/route";
import { GET as appConfig } from "@/app/api/v1/app/config/route";

const config = loadConfig(process.env);
const noParams = { params: Promise.resolve({}) };
let acme: Login;
let globex: Login;

const json = (url: string, client: string, body: unknown) =>
  new Request(`http://localhost/api/v1/${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-client-id": client },
  });
const me = (l: Login, client: string) =>
  getMe(
    new Request("http://localhost/api/v1/users/me", {
      headers: { authorization: `Bearer ${l.accessToken}`, "x-client-id": client },
    }),
    noParams,
  );
const code = async (res: Response) => (await envelope(res)).error?.code;

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  await seedTwoTenants();
  acme = await loginAs("acme", "alice@shared.test");
  globex = await loginAs("globex", "alice@shared.test");
});

describe("tenant suspension", () => {
  it("blocks every acme entry point with 403 TENANT_SUSPENDED and leaves globex alone", async () => {
    // Sanity: everything works before suspension (also warms the tenant cache).
    expect((await me(acme, "acme")).status).toBe(200);
    expect(
      (
        await appConfig(
          new Request("http://localhost/x", { headers: { "x-client-id": "acme" } }),
          noParams,
        )
      ).status,
    ).toBe(200);

    await new TenantAdminService(testPrisma()).setStatus("acme", "SUSPENDED");
    getContainer().tenantLookup.invalidate();

    const meRes = await me(acme, "acme");
    expect(meRes.status).toBe(403);
    expect(await code(meRes)).toBe("TENANT_SUSPENDED");

    const refreshRes = await refresh(
      json("auth/refresh", "acme", { refreshToken: acme.refreshToken }),
      noParams,
    );
    expect(refreshRes.status).toBe(403);
    expect(await code(refreshRes)).toBe("TENANT_SUSPENDED");

    const loginRes = await login(
      json("auth/login", "acme", { email: "alice@shared.test", password: SEED_PASSWORD }),
      noParams,
    );
    expect(loginRes.status).toBe(403);
    expect(await code(loginRes)).toBe("TENANT_SUSPENDED");

    const cfgRes = await appConfig(
      new Request("http://localhost/api/v1/app/config", { headers: { "x-client-id": "acme" } }),
      noParams,
    );
    expect(cfgRes.status).toBe(403);
    expect(await code(cfgRes)).toBe("TENANT_SUSPENDED");

    // globex is unaffected on every entry point.
    expect((await me(globex, "globex")).status).toBe(200);
    expect(
      (
        await refresh(
          json("auth/refresh", "globex", { refreshToken: globex.refreshToken }),
          noParams,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await login(
          json("auth/login", "globex", { email: "bob@shared.test", password: SEED_PASSWORD }),
          noParams,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await appConfig(
          new Request("http://localhost/api/v1/app/config", {
            headers: { "x-client-id": "globex" },
          }),
          noParams,
        )
      ).status,
    ).toBe(200);
  });

  it("reactivating the tenant restores access to the same token", async () => {
    const admin = new TenantAdminService(testPrisma());
    await admin.setStatus("acme", "SUSPENDED");
    getContainer().tenantLookup.invalidate();
    expect((await me(acme, "acme")).status).toBe(403);
    await admin.setStatus("acme", "ACTIVE");
    getContainer().tenantLookup.invalidate();
    expect((await me(acme, "acme")).status).toBe(200);
  });
});
