import type { AppError } from "../errors/app-error";

export type Pagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export function ok<T>(
  data: T,
  opts: { status?: number; pagination?: Pagination; requestId: string },
): Response {
  const meta = opts.pagination
    ? { requestId: opts.requestId, pagination: opts.pagination }
    : { requestId: opts.requestId };
  return Response.json(
    { success: true, data, meta },
    { status: opts.status ?? 200, headers: { "x-request-id": opts.requestId } },
  );
}

export function fail(err: AppError, requestId: string): Response {
  const error: { code: string; message: string; details?: unknown } = {
    code: err.code,
    message: err.message,
  };
  if (err.details !== undefined) error.details = err.details;
  return Response.json(
    { success: false, error, meta: { requestId } },
    { status: err.status, headers: { ...err.headers, "x-request-id": requestId } },
  );
}
