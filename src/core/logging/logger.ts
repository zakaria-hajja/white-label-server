import pino, { type DestinationStream } from "pino";

const SENSITIVE = [
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "refreshToken",
  "token",
  "accessToken",
  "authorization",
  "cookie",
];

// Covers each key at top level and up to three levels deep under any parents,
// including the common `req.headers.*` and `req.body.*` shapes.
export const REDACT_PATHS = SENSITIVE.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `*.*.*.${k}`]);

export function createLogger(level: string, destination?: DestinationStream): pino.Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: "[Redacted]" } }, destination);
}
