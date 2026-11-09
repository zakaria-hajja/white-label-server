import type { Logger } from "pino";
import { dummyVerify, hashPassword, verifyPassword } from "@/core/auth/password";
import { signAccessToken, type JwtConfig } from "@/core/auth/jwt";
import { generateOpaqueToken, hashToken } from "@/core/auth/tokens";
import { isUniqueViolation } from "@/core/database/prisma-errors";
import { AppError } from "@/core/errors/app-error";
import type { Clock } from "@/shared/clock";
import type { TenantContext } from "@/core/tenant/tenant-context";
import type { AuthRepository } from "./auth.repository";
import type { LoginInput, RegisterInput } from "./auth.schemas";
import type { AppConfigReader } from "../app-config/app-config.reader";
import type { Mailer } from "../mail/mailer";
import { buildResetLink } from "./reset-link";
import { toSessionDto, toUserDto, type SessionDto, type UserDto } from "./user.dto";
import type { AuthContext } from "@/core/auth/auth-context";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

export type AuthServiceConfig = {
  jwt: JwtConfig;
  sessionTtlDays: number;
};

export type ResetDeps = {
  passwordResetTtlMinutes: number;
  appConfig: AppConfigReader;
  mailer: Mailer;
  logger: Logger;
};

export type RequestMeta = { userAgent: string | null; ip: string };

export type AuthResult = { user: UserDto; tokens: TokenPair };

const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60_000;
const REUSE_GRACE_MS = 10_000;
const DAY_MS = 86_400_000;
const MAX_USER_AGENT = 512;

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly cfg: AuthServiceConfig,
    private readonly clock: Clock,
    private readonly reset: ResetDeps,
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
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
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
      // An expired lock starts a fresh count (the guards above ruled out an active lock).
      if (user.lockedUntil !== null) await this.repo.resetFailedLogins(ctx.tenantId, user.id);
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

  async refresh(ctx: TenantContext, refreshToken: string): Promise<TokenPair> {
    const now = this.clock.now();
    const invalid = () => new AppError("INVALID_REFRESH_TOKEN");
    const tokenHash = hashToken(refreshToken);
    const found = await this.repo.findRefreshTokenByHash(tokenHash);
    if (!found) throw invalid();
    const { token, session } = found;
    // Another tenant's token is indistinguishable from an unknown one and never revokes anything.
    if (session.tenantId !== ctx.tenantId) throw invalid();
    if (session.revokedAt !== null || session.expiresAt <= now || token.expiresAt <= now) {
      throw invalid();
    }
    const user = await this.repo.findUserById(ctx.tenantId, session.userId);
    if (!user || user.status !== "ACTIVE") throw invalid();

    const next = generateOpaqueToken();
    const claimed = await this.repo.transaction(async (repo) => {
      if (!(await repo.claimRefreshToken(token.id, now))) return false;
      // The session's absolute lifetime is not extended.
      await repo.createRefreshToken(session.id, hashToken(next), session.expiresAt);
      await repo.touchSession(ctx.tenantId, session.id, now);
      return true;
    });
    if (!claimed) {
      const current = await this.repo.findRefreshTokenByHash(tokenHash);
      const usedAt = current?.token.usedAt ?? null;
      // Within the grace window this is a benign retry or race: reject, keep the session.
      if (usedAt === null || now.getTime() - usedAt.getTime() >= REUSE_GRACE_MS) {
        await this.repo.revokeSession(ctx.tenantId, session.id, "refresh_token_reuse", now);
      }
      throw invalid();
    }
    return this.tokens(user.id, ctx, session, next, now);
  }

  async logout(ctx: TenantContext, refreshToken: string): Promise<void> {
    const found = await this.repo.findRefreshTokenByHash(hashToken(refreshToken));
    if (!found || found.session.tenantId !== ctx.tenantId) return;
    await this.repo.revokeSession(ctx.tenantId, found.session.id, "logout", this.clock.now());
  }

  async me(ctx: TenantContext, auth: AuthContext) {
    const [user, session] = await Promise.all([
      this.repo.findUserById(auth.tenantId, auth.userId),
      this.repo.findSession(auth.tenantId, auth.userId, auth.sessionId),
    ]);
    if (!user || !session) throw new AppError("UNAUTHENTICATED");
    return {
      user: toUserDto(user),
      tenant: { slug: ctx.slug, name: ctx.name },
      session: { id: session.id, expiresAt: session.expiresAt.toISOString() },
    };
  }

  async listSessions(ctx: TenantContext, auth: AuthContext): Promise<SessionDto[]> {
    const sessions = await this.repo.listActiveSessions(
      ctx.tenantId,
      auth.userId,
      this.clock.now(),
    );
    return sessions.map((s) => toSessionDto(s, auth.sessionId));
  }

  async revokeSession(ctx: TenantContext, auth: AuthContext, sessionId: string): Promise<void> {
    const session = await this.repo.findSession(ctx.tenantId, auth.userId, sessionId);
    if (!session) throw new AppError("NOT_FOUND");
    await this.repo.revokeSession(ctx.tenantId, session.id, "user_revoked", this.clock.now());
  }

  /** Always resolves: the response must not reveal whether the account exists. */
  async forgotPassword(ctx: TenantContext, email: string): Promise<void> {
    const user = await this.repo.findUserByEmail(ctx.tenantId, email);
    if (!user || user.status !== "ACTIVE") return;
    const now = this.clock.now();
    const token = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + this.reset.passwordResetTtlMinutes * 60_000);
    await this.repo.transaction(async (repo) => {
      await repo.invalidateResetTokens(ctx.tenantId, user.id, now);
      await repo.createResetToken(ctx.tenantId, user.id, hashToken(token), expiresAt);
    });
    try {
      const doc = await this.reset.appConfig.getDocument(ctx.tenantId);
      await this.reset.mailer.sendPasswordReset({
        to: user.email,
        tenantName: ctx.name,
        resetLink: buildResetLink(doc.passwordReset.linkBaseUrl, token),
        expiresAt,
      });
    } catch (err) {
      // Never surfaced: a failure here must not become an account-existence oracle.
      this.reset.logger.error(
        { err, tenantId: ctx.tenantId },
        "failed to send password reset email",
      );
    }
  }

  async resetPassword(ctx: TenantContext, token: string, newPassword: string): Promise<void> {
    const invalid = () => new AppError("INVALID_RESET_TOKEN");
    const found = await this.repo.findResetTokenByHash(hashToken(token));
    const now = this.clock.now();
    // A token from another tenant is indistinguishable from an unknown one and is not consumed.
    if (!found || found.tenantId !== ctx.tenantId) throw invalid();
    if (found.usedAt !== null || found.expiresAt <= now) throw invalid();
    const user = await this.repo.findUserById(ctx.tenantId, found.userId);
    if (!user || user.status !== "ACTIVE") throw invalid();

    // Argon2 is slow: hash before opening the transaction.
    const passwordHash = await hashPassword(newPassword);
    await this.repo.transaction(async (repo) => {
      if (!(await repo.consumeResetToken(found.id, now))) throw invalid();
      await repo.updatePassword(ctx.tenantId, user.id, passwordHash, now);
      await repo.revokeAllSessions(ctx.tenantId, user.id, "password_reset", now);
      await repo.invalidateResetTokens(ctx.tenantId, user.id, now);
    });
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
