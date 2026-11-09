import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";

const config = loadConfig(process.env);
const ctx = { params: Promise.resolve({}) };

const post = (
  handler: typeof register,
  body: unknown,
  tenant: string | null = "acme",
  extra: Record<string, string> = {},
) =>
  handler(
    new Request("http://localhost/api/v1/auth/x", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(tenant ? { "x-client-id": tenant } : {}),
        ...extra,
      },
    }),
    ctx,
  );

const PASSWORD = "correct-horse-1";

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  await createTenant("acme");
  await createTenant("globex");
});

describe("POST /auth/register", () => {
  it("creates a user, session and refresh token; normalises email; leaks nothing", async () => {
    const res = await post(
      register,
      {
        email: " Bob@Example.com ",
        password: PASSWORD,
        firstName: "Bob",
      },
      "acme",
      { "user-agent": "jest-ua" },
    );
    expect(res.status).toBe(201);
    const text = JSON.stringify(await envelope(res));
    const body = JSON.parse(text) as {
      data: { user: Record<string, unknown>; tokens: Record<string, unknown> };
    };
    expect(body.data.user).toMatchObject({
      email: "bob@example.com",
      firstName: "Bob",
      lastName: null,
    });
    expect(body.data.tokens).toMatchObject({
      tokenType: "Bearer",
      expiresIn: config.jwt.accessTtlSeconds,
    });
    expect(text).not.toMatch(/passwordHash|failedLoginCount|lockedUntil/);
    const prisma = testPrisma();
    expect(await prisma.session.count()).toBe(1);
    expect(await prisma.refreshToken.count()).toBe(1);
    const session = await prisma.session.findFirstOrThrow();
    expect(session).toMatchObject({ userAgent: "jest-ua", ipAddress: null });
  });

  it("returns 409 for the same email (case/space-insensitive) in one tenant, 201 in another", async () => {
    expect((await post(register, { email: " Bob@Example.com ", password: PASSWORD })).status).toBe(
      201,
    );
    const dup = await post(register, { email: "bob@example.com", password: PASSWORD });
    expect(dup.status).toBe(409);
    expect((await envelope(dup)).error).toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
    expect(
      (await post(register, { email: "bob@example.com", password: PASSWORD }, "globex")).status,
    ).toBe(201);
    expect(await testPrisma().user.count()).toBe(2);
  });

  it("rejects a short password and unknown fields with 400", async () => {
    expect((await post(register, { email: "a@b.co", password: "short" })).status).toBe(400);
    expect(
      (await post(register, { email: "a@b.co", password: PASSWORD, role: "admin" })).status,
    ).toBe(400);
  });

  it("requires a tenant in shared mode", async () => {
    expect((await post(register, { email: "a@b.co", password: PASSWORD }, null)).status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await post(register, { email: "bob@example.com", password: PASSWORD });
  });

  it("logs in with a differently-cased email", async () => {
    const res = await post(login, { email: "BOB@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    const body = await envelope(res);
    expect(body.data).toMatchObject({
      user: { email: "bob@example.com" },
      tokens: { tokenType: "Bearer" },
    });
    expect(await testPrisma().session.count()).toBe(2);
  });

  it("rejects a wrong password, including a short one, with INVALID_CREDENTIALS", async () => {
    for (const password of ["wrong-password-1", "x"]) {
      const res = await post(login, { email: "bob@example.com", password });
      expect(res.status).toBe(401);
      expect((await envelope(res)).error).toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
  });

  it("does not log in with the other tenant's header", async () => {
    const res = await post(login, { email: "bob@example.com", password: PASSWORD }, "globex");
    expect(res.status).toBe(401);
    expect((await envelope(res)).error).toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("locks the account after 10 failures even with the correct password", async () => {
    const prisma = testPrisma();
    await prisma.user.updateMany({ data: { failedLoginCount: 9 } });
    await post(login, { email: "bob@example.com", password: "wrong-password-1" });
    const user = await prisma.user.findFirstOrThrow();
    expect(user.failedLoginCount).toBe(10);
    expect(user.lockedUntil).not.toBeNull();
    const res = await post(login, { email: "bob@example.com", password: PASSWORD });
    expect(res.status).toBe(401);
    expect((await envelope(res)).error).toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("returns 429 with Retry-After on the 6th attempt within a minute", async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        (await post(login, { email: "bob@example.com", password: "wrong-password-1" })).status,
      ).toBe(401);
    }
    const res = await post(login, { email: "bob@example.com", password: PASSWORD });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await envelope(res)).error).toMatchObject({ code: "RATE_LIMITED" });
  });
});
