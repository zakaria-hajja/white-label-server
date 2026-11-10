import { isIP } from "node:net";

/**
 * Client IP for rate limiting and logging. Proxy headers are only honoured when trustProxy is set.
 *
 * Proxies append to X-Forwarded-For, so everything left of what our own proxies wrote is
 * client-controlled. With `hops` proxies we control in front of the app, the client IP is the
 * `hops`-th entry from the right; entries further left are ignored (they may be spoofed).
 * X-Real-IP is used only when X-Forwarded-For is absent. Returns "unknown" when nothing valid is
 * available (too few entries, or the entry is not an IP), so IP-keyed rate limits are skipped.
 */
export function clientIp(req: Request, trustProxy: boolean, hops: number): string {
  if (!trustProxy) return "unknown";
  const xff = req.headers.get("x-forwarded-for");
  if (xff !== null && xff.trim() !== "") {
    const entries = xff.split(",").map((e) => e.trim());
    const entry = entries.length >= hops ? entries[entries.length - hops] : undefined;
    return entry && isIP(entry) !== 0 ? entry : "unknown";
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real && isIP(real) !== 0 ? real : "unknown";
}
