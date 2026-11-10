import type { ZodError } from "zod";
import { AppError } from "../errors/app-error";

export const VALIDATION_MESSAGE = "Request validation failed";

/** One `{ path, message }` per Zod issue: the `details` of a 400 VALIDATION_ERROR. */
export function validationDetails(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** The 400 VALIDATION_ERROR for a failed body, query or params parse. */
export function validationError(err: ZodError): AppError {
  return new AppError("VALIDATION_ERROR", VALIDATION_MESSAGE, validationDetails(err));
}
