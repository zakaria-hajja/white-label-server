import type { PrismaClient } from "../database/prisma";
import { AppError } from "../errors/app-error";
import type { Logger } from "pino";
import type { AccessClaims } from "./jwt";

export interface SessionCheck {
  assertLive(claims: AccessClaims, now: Date): Promise<void>;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export class PrismaSessionCheck implements SessionCheck {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  async assertLive(claims: AccessClaims, now: Date): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        tenantId: claims.tid,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { status: "ACTIVE" },
      },
      select: { lastUsedAt: true },
    });
    if (!session) throw new AppError("UNAUTHENTICATED");
    if (now.getTime() - session.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
      try {
        await this.prisma.session.update({ where: { id: claims.sid }, data: { lastUsedAt: now } });
      } catch (err) {
        this.logger.warn({ err }, "failed to update session lastUsedAt");
      }
    }
  }
}
