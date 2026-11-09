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

export const REDACT_PATHS = SENSITIVE.flatMap((k) => [k, `*.${k}`, `headers.${k}`]).filter(
  (p, i, a) => a.indexOf(p) === i,
);

export function createLogger(level: string, destination?: DestinationStream): pino.Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: "[Redacted]" } }, destination);
}
