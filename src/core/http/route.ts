import { ZodError, type ZodType } from "zod";
import { AppError } from "../errors/app-error";
import type { AuthContext } from "../auth/auth-context";
import { getContainer, type Container, type Logger } from "../container";
import { createLogger } from "../logging/logger";
import { CLIENT_ID_HEADER, type TenantContext } from "../tenant/tenant-context";
import { readJsonBody } from "./body";
import { verifyAccessToken } from "../auth/jwt";
import { clientIp } from "./client-ip";
import { fail } from "./envelope";
import type { RateLimitRule } from "../rate-limit/rate-limiter";
import { resolveRequestId } from "./request-id";

export type TenantMode = "required" | "none";

export type AuthMode = "none" | "required";

export type RouteContext<
  B,
  Q,
  P,
  T extends TenantMode = TenantMode,
  A extends AuthMode = AuthMode,
> = {
  req: Request;
  requestId: string;
  ip: string;
  body: B;
  query: Q;
  params: P;
  tenant: T extends "required" ? TenantContext : null;
  auth: A extends "required" ? AuthContext : null;
  container: Container;
  logger: Logger;
};

/**
 * `auth: "required"` implies tenant resolution (the token's tenant is authoritative), so it is only
 * allowed together with `tenant: "required"`; route() throws at definition time otherwise.
 */
export type RouteDef<B, Q, P, T extends TenantMode = TenantMode, A extends AuthMode = AuthMode> = {
  auth: A;
  tenant: T;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
  /** Evaluated after input parsing, before the handler. */
  rateLimit?: RateLimitRule[];
  handler: (c: RouteContext<B, Q, P, T, A>) => Promise<Response>;
};

export type RouteHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/** Static description of a route, attached to the handler so the OpenAPI contract test can check it. */
export type RouteMeta = Pick<
  RouteDef<unknown, unknown, unknown>,
  "auth" | "tenant" | "body" | "query" | "params" | "rateLimit"
>;

export type DescribedRouteHandler = RouteHandler & { meta: RouteMeta };

// Used only when the container (and so its logger) cannot be built.
const fallbackLogger = createLogger("info").child({ component: "route-fallback" });

const GENERIC_MESSAGE = "An unexpected error occurred";

export function route<
  B = undefined,
  Q = undefined,
  P = undefined,
  T extends TenantMode = TenantMode,
  A extends AuthMode = AuthMode,
>(def: RouteDef<B, Q, P, T, A>): DescribedRouteHandler {
  if (def.auth === "required" && def.tenant !== "required") {
    throw new Error('route(): auth "required" needs tenant "required"');
  }

  const handler: RouteHandler = async (req, ctx) => {
    const started = performance.now();
    const requestId = resolveRequestId(req);
    let logger: Logger = fallbackLogger;
    let tenant: TenantContext | null = null;
    let auth: AuthContext | null = null;
    let response: Response;
    try {
      const container = getContainer();
      logger = container.logger.child({ requestId });
      // Order: tenant (+ auth) -> input parsing -> rate limit -> handler.
      if (def.auth === "required") {
        const now = container.clock.now();
        const claims = await verifyAccessToken(
          container.config.jwt,
          extractBearer(req.headers.get("authorization")),
          now,
        );
        tenant = await container.tenantResolver.resolve({
          clientId: req.headers.get(CLIENT_ID_HEADER),
          tokenTenantId: claims.tid,
        });
        await container.sessionCheck.assertLive(claims, now);
        auth = { userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid };
      } else if (def.tenant === "required") {
        tenant = await container.tenantResolver.resolve({
          clientId: req.headers.get(CLIENT_ID_HEADER),
          tokenTenantId: null,
        });
      }
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
      const ip = clientIp(req, container.config.trustProxy);
      for (const rule of def.rateLimit ?? []) {
        const key = rule.key({ ip, body, tenant, auth });
        if (key === null) continue;
        const r = container.rateLimiter.hit(`${rule.name}:${key}`, rule.limit, rule.windowSeconds);
        if (!r.allowed) {
          throw new AppError("RATE_LIMITED", undefined, undefined, {
            "retry-after": String(Math.max(1, Math.ceil(r.retryAfterSeconds))),
          });
        }
      }
      // The tenant/auth types are guaranteed by the branches above; TS cannot see through T and A.
      const routeCtx = {
        req,
        requestId,
        ip,
        body,
        query,
        params,
        tenant,
        auth,
        container,
        logger,
      } as RouteContext<B, Q, P, T, A>;
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
  const meta: RouteMeta = {
    auth: def.auth,
    tenant: def.tenant,
    body: def.body,
    query: def.query,
    params: def.params,
    rateLimit: def.rateLimit,
  };
  return Object.assign(handler, { meta });
}

function extractBearer(header: string | null): string {
  const m = header ? /^bearer +(\S+)$/i.exec(header.trim()) : null;
  if (!m?.[1]) throw new AppError("UNAUTHENTICATED");
  return m[1];
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
