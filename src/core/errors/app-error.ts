import { ERROR_STATUS, type ErrorCode } from "./codes";

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? code);
    this.name = "AppError";
    this.status = ERROR_STATUS[code];
  }
}
