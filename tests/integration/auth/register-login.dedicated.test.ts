import { beforeEach, describe, expect, it } from "vitest";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";

const config = loadConfig(process.env);
const ctx = { params: Promise.resolve({}) };
const post = (handler: typeof register, body: unknown) =>
  handler(
    new Request("http://localhost/api/v1/auth/x", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    ctx,
  );

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  await createTenant("acme");
});

describe("dedicated mode auth", () => {
  it("registers and logs in without X-Client-Id", async () => {
    const body = { email: "bob@example.com", password: "correct-horse-1" };
    expect((await post(register, body)).status).toBe(201);
    expect((await post(login, body)).status).toBe(200);
  });
});
