import { ZodError, type ZodType } from "zod";
import { AppError } from "../errors/app-error";
import type { AuthContext } from "../auth/auth-context";
import { getContainer, type Container, type Logger } from "../container";
import { createLogger } from "../logging/logger";
import { CLIENT_ID_HEADER, type TenantContext } from "../tenant/tenant-context";
import { readJsonBody } from "./body";
import { clientIp } from "./client-ip";
import { fail } from "./envelope";
import { resolveRequestId } from "./request-id";

export type TenantMode = "required" | "none";

export type RouteContext<B, Q, P, T extends TenantMode = TenantMode> = {
  req: Request;
  requestId: string;
  ip: string;
  body: B;
  query: Q;
  params: P;
  tenant: T extends "required" ? TenantContext : null;
  auth: AuthContext | null;
  container: Container;
  logger: Logger;
};

export type RouteDef<B, Q, P, T extends TenantMode = TenantMode> = {
  auth: "none" | "required";
  tenant: T;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  handler: (c: RouteContext<B, Q, P, T>) => Promise<Response>;
};

export type RouteHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

// Used only when the container (and so its logger) cannot be built.
const fallbackLogger = createLogger("info").child({ component: "route-fallback" });

const GENERIC_MESSAGE = "An unexpected error occurred";

export function route<
  B = undefined,
  Q = undefined,
  P = undefined,
  T extends TenantMode = TenantMode,
>(def: RouteDef<B, Q, P, T>): RouteHandler {
  // Authentication (Task 8) is not wired yet.
  if (def.auth === "required") {
    throw new Error('route(): auth "required" is not wired yet (Task 8)');
  }

  return async (req, ctx) => {
    const started = performance.now();
    const requestId = resolveRequestId(req);
    let logger: Logger = fallbackLogger;
    let tenant: TenantContext | null = null;
    let response: Response;
    try {
      const container = getContainer();
      logger = container.logger.child({ requestId });
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
      if (def.tenant === "required") {
        tenant = await container.tenantResolver.resolve({
          clientId: req.headers.get(CLIENT_ID_HEADER),
          tokenTenantId: null, // Task 8 passes the verified token's tenant
        });
      }
      // The tenant type is guaranteed by the branch above; TS cannot see through T.
      const routeCtx = {
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
      } as RouteContext<B, Q, P, T>;
      response = await def.handler(routeCtx);
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
        ...(tenant ? { tenant: tenant.slug } : {}),
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
