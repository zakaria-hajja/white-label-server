import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, getContainer, setContainer } from "@/core/container";
import { TenantAdminService } from "@/core/tenant/tenant-admin.service";
import { seed } from "../../../prisma/seed-data";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { GET as list } from "@/app/api/v1/catalog/route";
import { GET as getOne } from "@/app/api/v1/catalog/[id]/route";

const config = loadConfig(process.env);
const noParams = { params: Promise.resolve({}) };

async function signup(email: string, tenant: string): Promise<string> {
  const res = await register(
    new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: "correct-horse-1" }),
      headers: { "content-type": "application/json", "x-client-id": tenant },
    }),
    noParams,
  );
  return ((await envelope(res)).data?.tokens as { accessToken: string }).accessToken;
}

const headers = (token: string, tenant = "acme") => ({
  authorization: `Bearer ${token}`,
  "x-client-id": tenant,
});
const callList = (token: string, qs = "", tenant = "acme") =>
  list(
    new Request(`http://localhost/api/v1/catalog${qs}`, { headers: headers(token, tenant) }),
    noParams,
  );
const callGet = (token: string, id: string, tenant = "acme") =>
  getOne(
    new Request(`http://localhost/api/v1/catalog/${id}`, { headers: headers(token, tenant) }),
    {
      params: Promise.resolve({ id }),
    },
  );

type Item = { id: string; title: string; category: string | null };
const items = async (res: Response) => (await envelope(res)).data as unknown as Item[];
const pagination = async (res: Response) =>
  (await envelope(res)).meta as unknown as {
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  };

let token: string;

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  await seed(testPrisma(), config);
  token = await signup("a@x.co", "acme");
});

describe("GET /catalog", () => {
  it("requires a token", async () => {
    const res = await list(new Request("http://localhost/api/v1/catalog"), noParams);
    expect(res.status).toBe(401);
  });

  it("paginates 25 items with pageSize=10 and only returns acme items", async () => {
    const res = await callList(token, "?pageSize=10");
    expect(res.status).toBe(200);
    expect(await items(res.clone())).toHaveLength(10);
    expect((await pagination(res)).pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: 25,
      totalPages: 3,
    });
    const globexIds = (
      await testPrisma().catalogItem.findMany({ where: { tenant: { slug: "globex" } } })
    ).map((i) => i.id);
    const all = await items(await callList(token, "?pageSize=100"));
    expect(all).toHaveLength(25);
    expect(all.some((i) => globexIds.includes(i.id))).toBe(false);
    expect(Object.keys(all[0] ?? {}).sort()).toEqual([
      "category",
      "createdAt",
      "description",
      "id",
      "imageUrl",
      "title",
      "updatedAt",
    ]);
  });

  it("q matches case-insensitively", async () => {
    const found = await items(await callList(token, "?q=sHaReD%20tItLe"));
    expect(found.map((i) => i.title)).toEqual(["Shared Title Example"]);
  });

  it("empty q is ignored", async () => {
    expect((await pagination(await callList(token, "?q=%20"))).pagination.totalItems).toBe(25);
  });

  it("category filters", async () => {
    const found = await items(await callList(token, "?category=Music&pageSize=100"));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((i) => i.category === "Music")).toBe(true);
  });

  it("sort=title:asc is ordered", async () => {
    const titles = (await items(await callList(token, "?sort=title:asc&pageSize=100"))).map(
      (i) => i.title,
    );
    expect(titles).toEqual([...titles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("page beyond the end is empty with correct totals", async () => {
    const res = await callList(token, "?page=99");
    expect(await items(res.clone())).toEqual([]);
    expect((await pagination(res)).pagination).toMatchObject({ totalItems: 25, totalPages: 2 });
  });

  it.each(["?pageSize=1000", "?sort=password:asc", "?bogus=1"])("%s -> 400", async (qs) => {
    const res = await callList(token, qs);
    expect(res.status).toBe(400);
    expect((await envelope(res)).error?.code).toBe("VALIDATION_ERROR");
  });

  it("disabled feature -> 404 FEATURE_DISABLED for that tenant only", async () => {
    await new TenantAdminService(testPrisma()).setFeature("acme", "catalog", false);
    getContainer().featureFlags.invalidate();
    const res = await callList(token);
    expect(res.status).toBe(404);
    expect((await envelope(res)).error?.code).toBe("FEATURE_DISABLED");
    const gToken = await signup("g@x.co", "globex");
    expect((await callList(gToken, "", "globex")).status).toBe(200);
  });
});

describe("GET /catalog/{id}", () => {
  it("returns an item", async () => {
    const [first] = await items(await callList(token));
    const res = await callGet(token, first!.id);
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toMatchObject({ id: first!.id });
  });

  it("non-UUID -> 404 NOT_FOUND", async () => {
    const res = await callGet(token, "not-a-uuid");
    expect(res.status).toBe(404);
    expect((await envelope(res)).error?.code).toBe("NOT_FOUND");
  });

  it("another tenant's item -> 404 NOT_FOUND", async () => {
    const other = await testPrisma().catalogItem.findFirstOrThrow({
      where: { tenant: { slug: "globex" } },
    });
    const res = await callGet(token, other.id);
    expect(res.status).toBe(404);
    expect((await envelope(res)).error?.code).toBe("NOT_FOUND");
  });
});
