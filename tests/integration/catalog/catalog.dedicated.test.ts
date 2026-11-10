import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { seed } from "../../../prisma/seed-data";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { GET as list } from "@/app/api/v1/catalog/route";

const config = loadConfig(process.env);
const noParams = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  await seed(testPrisma(), config);
});

describe("GET /catalog (dedicated)", () => {
  it("lists without a client header", async () => {
    const reg = await register(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "a@x.co", password: "correct-horse-1" }),
        headers: { "content-type": "application/json" },
      }),
      noParams,
    );
    const token = ((await envelope(reg)).data?.tokens as { accessToken: string }).accessToken;
    const res = await list(
      new Request("http://localhost/api/v1/catalog", {
        headers: { authorization: `Bearer ${token}` },
      }),
      noParams,
    );
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toHaveLength(20);
  });
});
