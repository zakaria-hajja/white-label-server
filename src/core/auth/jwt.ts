import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { AppConfig } from "../config/env";
import { AppError } from "../errors/app-error";

export type JwtConfig = AppConfig["jwt"];

export type AccessClaims = { sub: string; tid: string; sid: string };

const claimsSchema = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  sid: z.uuid(),
});

export function signAccessToken(cfg: JwtConfig, claims: AccessClaims, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ tid: claims.tid, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(cfg.issuer)
    .setAudience(cfg.audience)
    .setIssuedAt(iat)
    .setExpirationTime(iat + cfg.accessTtlSeconds)
    .sign(cfg.secret);
}

export async function verifyAccessToken(
  cfg: JwtConfig,
  token: string,
  now: Date = new Date(),
): Promise<AccessClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, cfg.secret, {
      algorithms: ["HS256"],
      issuer: cfg.issuer,
      audience: cfg.audience,
      requiredClaims: ["sub", "tid", "sid", "exp", "iss", "aud"],
      currentDate: now,
    }));
  } catch (err) {
    if (err instanceof errors.JWTExpired) throw new AppError("TOKEN_EXPIRED");
    throw new AppError("UNAUTHENTICATED");
  }
  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("UNAUTHENTICATED");
  const { sub, tid, sid } = parsed.data;
  return { sub, tid, sid };
}
