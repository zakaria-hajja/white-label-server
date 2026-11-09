import { ZodError, type ZodType } from "zod";
import { AppError } from "../errors/app-error";
import type { AuthContext } from "../auth/auth-context";
import { getContainer, type Container, type Logger } from "../container";
import type { TenantContext } from "../tenant/tenant-context";
import { readJsonBody } from "./body";
import { clientIp } from "./client-ip";
import { fail } from "./envelope";
import { resolveRequestId } from "./request-id";

export type RouteContext<B, Q, P> = {
  req: Request;
  requestId: string;
  ip: string;
  body: B;
  query: Q;
  params: P;
  tenant: TenantContext | null;
  auth: AuthContext | null;
  container: Container;
  logger: Logger;
};

export type RouteDef<B, Q, P> = {
  auth: "none" | "required";
  tenant: "required" | "none";
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  handler: (c: RouteContext<B, Q, P>) => Promise<Response>;
};

export type RouteHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const GENERIC_MESSAGE = "An unexpected error occurred";

export function route<B = undefined, Q = undefined, P = undefined>(
  def: RouteDef<B, Q, P>,
): RouteHandler {
  // Tenant resolution (Task 6) and authentication (Task 8) are not wired yet.
  if (def.tenant === "required") {
    throw new Error('route(): tenant "required" is not wired yet (Task 6)');
  }
  if (def.auth === "required") {
    throw new Error('route(): auth "required" is not wired yet (Task 8)');
  }

  return async (req, ctx) => {
    const started = performance.now();
    const requestId = resolveRequestId(req);
    const container = getContainer();
    const logger = container.logger.child({ requestId });
    const tenant: TenantContext | null = null;
    let response: Response;
    try {
      const params = (def.params ? def.params.parse(await ctx.params) : undefined) as P;
      const url = new URL(req.url);
      const query = (
        def.query ? def.query.parse(Object.fromEntries(url.searchParams)) : undefined
      ) as Q;
      const body = (
        def.body
          ? def.body.parse(await readJsonBody(req, container.config.maxBodyBytes))
          : undefined
      ) as B;
      response = await def.handler({
        req,
        requestId,
        ip: clientIp(req, container.config.trustProxy),
        body,
        query,
        params,
        tenant,
        auth: null,
        container,
        logger,
      });
      response.headers.set("x-request-id", requestId);
    } catch (err) {
      response = toErrorResponse(err, requestId, logger);
    }
    logger.info(
      {
        method: req.method,
        path: new URL(req.url).pathname,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
        ...(tenant ? { tenant: (tenant as TenantContext).slug } : {}),
      },
      "request",
    );
    return response;
  };
}

function toErrorResponse(err: unknown, requestId: string, logger: Logger): Response {
  if (err instanceof AppError) return fail(err, requestId);
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return fail(new AppError("VALIDATION_ERROR", "Request validation failed", details), requestId);
  }
  logger.error({ err }, "unhandled error");
  return fail(new AppError("INTERNAL_ERROR", GENERIC_MESSAGE), requestId);
}
