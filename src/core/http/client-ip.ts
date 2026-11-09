import { isIP } from "node:net";

/**
 * Client IP for rate limiting and logging. X-Forwarded-For is only honoured when
 * trustProxy is set (the app sits behind a proxy that overwrites it); the first
 * entry is used. Falls back to "unknown" when nothing valid is available.
 */
export function clientIp(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first && isIP(first) !== 0) return first;
    const real = req.headers.get("x-real-ip")?.trim();
    if (real && isIP(real) !== 0) return real;
  }
  return "unknown";
}
