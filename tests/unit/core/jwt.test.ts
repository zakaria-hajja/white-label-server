import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { hashToken, generateOpaqueToken } from "@/core/auth/tokens";
import { signAccessToken, verifyAccessToken } from "@/core/auth/jwt";
import { AppError } from "@/core/errors/app-error";

const cfg = {
  secret: new TextEncoder().encode("test-jwt-secret-test-jwt-secret-0123456789"),
  issuer: "whitelabel-api",
  audience: "whitelabel-api" as const,
  accessTtlSeconds: 900,
};
const claims = {
  sub: "0192f5a0-0000-7000-8000-000000000001",
  tid: "0192f5a0-0000-7000-8000-000000000002",
  sid: "0192f5a0-0000-7000-8000-000000000003",
};
const now = new Date("2026-01-01T00:00:00Z");
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

async function rejectsWith(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

const custom = (
  c: Record<string, unknown>,
  o: { iss?: string; aud?: string; secret?: Uint8Array } = {},
) =>
  new SignJWT(c)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(o.iss ?? cfg.issuer)
    .setAudience(o.aud ?? cfg.audience)
    .setIssuedAt(now)
    .setExpirationTime(new Date(now.getTime() + 900_000))
    .sign(o.secret ?? cfg.secret);

describe("access tokens", () => {
  it("round-trips and sets exp = iat + ttl", async () => {
    const token = await signAccessToken(cfg, claims, now);
    expect(await verifyAccessToken(cfg, token, now)).toEqual(claims);
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    expect(payload.iat).toBe(now.getTime() / 1000);
    expect(payload.exp).toBe(now.getTime() / 1000 + 900);
  });

  it("maps expiry to TOKEN_EXPIRED", async () => {
    const token = await signAccessToken(cfg, claims, now);
    await rejectsWith(
      verifyAccessToken(cfg, token, new Date(now.getTime() + 901_000)),
      "TOKEN_EXPIRED",
    );
  });

  it("rejects a foreign secret, alg none, wrong aud/iss, and garbage", async () => {
    const other = new TextEncoder().encode("another-secret-another-secret-0123456789");
    const t1 = await custom(
      { tid: claims.tid, sid: claims.sid, sub: claims.sub },
      { secret: other },
    );
    await rejectsWith(verifyAccessToken(cfg, t1, now), "UNAUTHENTICATED");
    const none = `${enc({ alg: "none", typ: "JWT" })}.${enc({
      ...claims,
      iss: cfg.issuer,
      aud: cfg.audience,
      exp: now.getTime() / 1000 + 900,
    })}.`;
    await rejectsWith(verifyAccessToken(cfg, none, now), "UNAUTHENTICATED");
    const t2 = await custom({ ...claims }, { aud: "other" });
    await rejectsWith(verifyAccessToken(cfg, t2, now), "UNAUTHENTICATED");
    const t3 = await custom({ ...claims }, { iss: "evil" });
    await rejectsWith(verifyAccessToken(cfg, t3, now), "UNAUTHENTICATED");
    await rejectsWith(verifyAccessToken(cfg, "garbage", now), "UNAUTHENTICATED");
  });

  it("rejects a correctly signed token without exp (UNAUTHENTICATED)", async () => {
    const noExp = await new SignJWT({ tid: claims.tid, sid: claims.sid })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuer(cfg.issuer)
      .setAudience(cfg.audience)
      .setIssuedAt(now)
      .sign(cfg.secret);
    await rejectsWith(verifyAccessToken(cfg, noExp, now), "UNAUTHENTICATED");
  });

  it("rejects HS512 tokens even with the right secret", async () => {
    const t = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuer(cfg.issuer)
      .setAudience(cfg.audience)
      .setExpirationTime(new Date(now.getTime() + 900_000))
      .sign(cfg.secret);
    await rejectsWith(verifyAccessToken(cfg, t, now), "UNAUTHENTICATED");
  });

  it("rejects missing or non-UUID claims", async () => {
    for (const c of [
      { sub: claims.sub, sid: claims.sid },
      { sub: claims.sub, tid: claims.tid },
      { tid: claims.tid, sid: claims.sid },
      { ...claims, tid: "not-a-uuid" },
      { ...claims, sub: "x" },
    ]) {
      await rejectsWith(verifyAccessToken(cfg, await custom(c), now), "UNAUTHENTICATED");
    }
  });
});

describe("opaque tokens", () => {
  it("generates 43-char base64url tokens, unique", () => {
    const a = generateOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken()).not.toBe(a);
  });
  it("hashToken is deterministic sha256 hex", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
