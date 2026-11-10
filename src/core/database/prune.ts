import type { Clock } from "../../shared/clock";
import type { PrismaClient } from "./prisma";

const DAY_MS = 86_400_000;
/** Must cover the refresh reuse grace window (10 s, AuthService) so pruning never changes an outcome inside it. */
const USED_TOKEN_RETENTION_MS = DAY_MS + 10_000;
const DEAD_SESSION_RETENTION_MS = 7 * DAY_MS;
const RESET_TOKEN_RETENTION_MS = DAY_MS;

export type PruneCounts = { refreshTokens: number; sessions: number; passwordResetTokens: number };

/**
 * Deletes auth rows that can no longer affect any request. Idempotent; safe to run while the API
 * serves traffic.
 *
 * Tenant-agnostic by design: this is an operator job over the whole database (every tenant in
 * shared mode, the one tenant in dedicated mode), not request-scoped repository code, so it does
 * not take a tenantId. Every predicate is time/state based only.
 *
 * - Refresh tokens of a revoked or expired session (they can only ever return 401), used tokens
 *   older than the reuse grace window + 1 day, and superseded tokens older than 1 day. A deleted
 *   token presented later is "unknown": 401 without revoking anything.
 * - Sessions revoked or expired more than 7 days ago (their remaining tokens cascade). Kept that
 *   long so recently ended sessions stay inspectable.
 * - Password reset tokens used or expired more than 1 day ago.
 */
export async function pruneAuthData(prisma: PrismaClient, clock: Clock): Promise<PruneCounts> {
  const now = clock.now();
  const before = (ms: number) => new Date(now.getTime() - ms);

  const refreshTokens = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { session: { revokedAt: { not: null } } },
        { session: { expiresAt: { lte: now } } },
        { usedAt: { lt: before(USED_TOKEN_RETENTION_MS) } },
        { supersededAt: { lt: before(DAY_MS) } },
      ],
    },
  });
  const sessions = await prisma.session.deleteMany({
    where: {
      OR: [
        { revokedAt: { lt: before(DEAD_SESSION_RETENTION_MS) } },
        { expiresAt: { lt: before(DEAD_SESSION_RETENTION_MS) } },
      ],
    },
  });
  const passwordResetTokens = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [
        { usedAt: { lt: before(RESET_TOKEN_RETENTION_MS) } },
        { expiresAt: { lt: before(RESET_TOKEN_RETENTION_MS) } },
      ],
    },
  });
  return {
    refreshTokens: refreshTokens.count,
    sessions: sessions.count,
    passwordResetTokens: passwordResetTokens.count,
  };
}
