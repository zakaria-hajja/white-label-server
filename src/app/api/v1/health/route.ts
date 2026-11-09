import { ok } from "@/core/http/envelope";
import { route } from "@/core/http/route";

export const runtime = "nodejs";

// A 503 still uses the success envelope: the body is a well-formed health report
// (data.status = "degraded"), and the HTTP status carries the failure for probes.
export const GET = route({
  auth: "none",
  tenant: "none",
  handler: async ({ container, requestId, logger }) => {
    try {
      await container.prisma.$queryRaw`SELECT 1`;
      return ok({ status: "ok", db: "up" }, { requestId });
    } catch (err) {
      logger.error({ err }, "health check: database unreachable");
      return ok({ status: "degraded", db: "down" }, { status: 503, requestId });
    }
  },
});
