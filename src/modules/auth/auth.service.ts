import { dummyVerify, hashPassword, verifyPassword } from "@/core/auth/password";
import { signAccessToken } from "@/core/auth/jwt";
import { generateOpaqueToken, hashToken } from "@/core/auth/tokens";
import type { AppConfig } from "@/core/config/env";
import { isUniqueViolation } from "@/core/database/prisma-errors";
import { AppError } from "@/core/errors/app-error";
import type { Clock } from "@/shared/clock";
import type { TenantContext } from "@/core/tenant/tenant-context";
import type { AuthRepository } from "./auth.repository";
import type { LoginInput, RegisterInput } from "./auth.schemas";
import { toUserDto, type UserDto } from "./user.dto";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

export type AuthServiceConfig = {
  jwt: AppConfig["jwt"];
  sessionTtlDays: number;
};

export type RequestMeta = { userAgent: string | null; ip: string };

export type AuthResult = { user: UserDto; tokens: TokenPair };

const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const MAX_USER_AGENT = 512;

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly cfg: AuthServiceConfig,
    private readonly clock: Clock,
  ) {}

  async register(ctx: TenantContext, input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    const now = this.clock.now();
    const { user, session, refreshToken } = await this.repo.transaction(async (repo) => {
      let user;
      try {
        user = await repo.createUser(ctx.tenantId, {
          email: input.email,
          passwordHash,
          firstName: input.firstName ?? "",
          lastName: input.lastName ?? "",
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError("EMAIL_ALREADY_REGISTERED");
        throw err;
      }
      const issued = await this.createSession(repo, ctx.tenantId, user.id, meta, now);
      return { user, ...issued };
    });
    return {
      user: toUserDto(user),
      tokens: await this.tokens(user.id, ctx, session, refreshToken, now),
    };
  }

  async login(ctx: TenantContext, input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const now = this.clock.now();
    const user = await this.repo.findUserByEmail(ctx.tenantId, input.email);
    // Every rejection path spends one Argon2 verification so timing does not reveal the reason.
    if (!user) {
      await dummyVerify(input.password);
      throw new AppError("INVALID_CREDENTIALS");
    }
    if (user.status !== "ACTIVE" || (user.lockedUntil !== null && user.lockedUntil > now)) {
      await dummyVerify(input.password);
      throw new AppError("INVALID_CREDENTIALS");
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.repo.recordFailedLogin(
        ctx.tenantId,
        user.id,
        MAX_FAILED_LOGINS,
        new Date(now.getTime() + LOCK_MS),
      );
      throw new AppError("INVALID_CREDENTIALS");
    }
    if (user.failedLoginCount > 0 || user.lockedUntil !== null) {
      await this.repo.resetFailedLogins(ctx.tenantId, user.id);
    }
    const { session, refreshToken } = await this.repo.transaction((repo) =>
      this.createSession(repo, ctx.tenantId, user.id, meta, now),
    );
    return {
      user: toUserDto(user),
      tokens: await this.tokens(user.id, ctx, session, refreshToken, now),
    };
  }

  private async createSession(
    repo: AuthRepository,
    tenantId: string,
    userId: string,
    meta: RequestMeta,
    now: Date,
  ) {
    const expiresAt = new Date(now.getTime() + this.cfg.sessionTtlDays * DAY_MS);
    const session = await repo.createSession(
      tenantId,
      userId,
      {
        userAgent: meta.userAgent === null ? null : meta.userAgent.slice(0, MAX_USER_AGENT),
        ip: meta.ip === "unknown" ? null : meta.ip,
      },
      expiresAt,
    );
    const refreshToken = generateOpaqueToken();
    await repo.createRefreshToken(session.id, hashToken(refreshToken), expiresAt);
    return { session, refreshToken };
  }

  private async tokens(
    userId: string,
    ctx: TenantContext,
    session: { id: string },
    refreshToken: string,
    now: Date,
  ): Promise<TokenPair> {
    const accessToken = await signAccessToken(
      this.cfg.jwt,
      { sub: userId, tid: ctx.tenantId, sid: session.id },
      now,
    );
    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.cfg.jwt.accessTtlSeconds,
    };
  }
}
