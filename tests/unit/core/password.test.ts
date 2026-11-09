import { describe, expect, it } from "vitest";
import { dummyVerify, hashPassword, verifyPassword } from "@/core/auth/password";

describe("password hashing", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("Password123!");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "Password123!")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});

describe("dummyVerify", () => {
  it("always resolves without a value", async () => {
    await expect(dummyVerify("anything")).resolves.toBeUndefined();
  });
});
