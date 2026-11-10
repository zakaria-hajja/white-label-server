import { beforeEach, describe, expect, it } from "vitest";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { pruneAuthData } from "@/core/database/prune";

const DAY = 86_400_000;
const NOW = new Date("2026-06-01T00:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);
const clock = { now: () => NOW };

let seq = 0;
async function user(tenantId: string) {
  return testPrisma().user.create({
    data: { tenantId, email: `u${++seq}@x.co`, passwordHash: "h" },
  });
}
async function session(
  u: { id: string; tenantId: string },
  data: { expiresAt?: Date; revokedAt?: Date | null } = {},
) {
  return testPrisma().session.create({
    data: {
      tenantId: u.tenantId,
      userId: u.id,
      expiresAt: data.expiresAt ?? later(30 * DAY),
      revokedAt: data.revokedAt ?? null,
    },
  });
}
async function token(sessionId: string, data: { usedAt?: Date; supersededAt?: Date } = {}) {
  return testPrisma().refreshToken.create({
    data: { sessionId, tokenHash: `rt${++seq}`, expiresAt: later(30 * DAY), ...data },
  });
}
async function resetToken(
  u: { id: string; tenantId: string },
  data: { expiresAt: Date; usedAt?: Date },
) {
  return testPrisma().passwordResetToken.create({
    data: { tenantId: u.tenantId, userId: u.id, tokenHash: `pr${++seq}`, ...data },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("pruneAuthData", () => {
  it("removes dead rows across tenants and keeps live ones", async () => {
    const acme = await createTenant("acme");
    const globex = await createTenant("globex");
    const a = await user(acme.id);
    const g = await user(globex.id);

    // Live session: its live token, a recently used token (reuse detection) and an old used one.
    const live = await session(a);
    const liveToken = await token(live.id);
    const recentUsed = await token(live.id, { usedAt: ago(DAY - 60_000) });
    await token(live.id, { usedAt: ago(DAY + 11_000) });
    // Superseded more than a day ago: unusable, and deleting it changes no outcome (still 401).
    await token(live.id, { supersededAt: ago(2 * DAY) });
    // Revoked 2 days ago: tokens go, the session row stays (7-day retention).
    const revokedRecently = await session(g, { revokedAt: ago(2 * DAY) });
    await token(revokedRecently.id);
    // Revoked / expired more than 7 days ago: gone, with their tokens.
    const revokedOld = await session(a, { revokedAt: ago(8 * DAY) });
    await token(revokedOld.id);
    const expiredOld = await session(g, { expiresAt: ago(8 * DAY) });
    await token(expiredOld.id);
    // Expired 1 day ago: tokens go, the session stays for now.
    const expiredRecently = await session(a, { expiresAt: ago(DAY) });
    await token(expiredRecently.id);

    // Reset tokens: live, recently used, used 2 days ago, expired 2 days ago.
    const liveReset = await resetToken(a, { expiresAt: later(30 * 60_000) });
    const recentReset = await resetToken(g, { expiresAt: ago(60_000), usedAt: ago(60_000) });
    await resetToken(a, { expiresAt: ago(DAY), usedAt: ago(2 * DAY) });
    await resetToken(g, { expiresAt: ago(2 * DAY) });

    const counts = await pruneAuthData(testPrisma(), clock);
    expect(counts).toEqual({ refreshTokens: 6, sessions: 2, passwordResetTokens: 2 });

    const prisma = testPrisma();
    expect((await prisma.refreshToken.findMany()).map((t) => t.id).sort()).toEqual(
      [liveToken.id, recentUsed.id].sort(),
    );
    expect((await prisma.session.findMany()).map((s) => s.id).sort()).toEqual(
      [live.id, revokedRecently.id, expiredRecently.id].sort(),
    );
    expect((await prisma.passwordResetToken.findMany()).map((t) => t.id).sort()).toEqual(
      [liveReset.id, recentReset.id].sort(),
    );
  });

  it("keeps a token chain intact when a used predecessor is deleted", async () => {
    const acme = await createTenant("acme");
    const a = await user(acme.id);
    const s = await session(a);
    const successor = await token(s.id);
    const old = await token(s.id, { usedAt: ago(2 * DAY) });
    await testPrisma().refreshToken.update({
      where: { id: old.id },
      data: { replacedById: successor.id },
    });
    expect(await pruneAuthData(testPrisma(), clock)).toMatchObject({ refreshTokens: 1 });
    expect(
      await testPrisma().refreshToken.findUnique({ where: { id: successor.id } }),
    ).not.toBeNull();
  });

  it("is idempotent", async () => {
    const acme = await createTenant("acme");
    const a = await user(acme.id);
    await session(a, { revokedAt: ago(8 * DAY) });
    await pruneAuthData(testPrisma(), clock);
    expect(await pruneAuthData(testPrisma(), clock)).toEqual({
      refreshTokens: 0,
      sessions: 0,
      passwordResetTokens: 0,
    });
  });
});
