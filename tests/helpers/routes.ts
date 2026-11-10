import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { DescribedRouteHandler } from "@/core/http/route";

const ROUTE_ROOT = join(process.cwd(), "src/app/api/v1");
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : [],
  );
}

const loaders = import.meta.glob<Record<string, unknown>>("/src/app/api/v1/**/route.ts");

/** `key` is `METHOD /api/v1/path`, with `[id]` segments written as `{id}`. */
export type RouteInfo = {
  key: string;
  path: string;
  method: string;
  handler: DescribedRouteHandler;
};

/** Every exported method handler under src/app/api/v1, except the paths in `excluded`. */
export async function discoverRoutes(
  excluded: ReadonlySet<string> = new Set(),
): Promise<RouteInfo[]> {
  const out: RouteInfo[] = [];
  for (const file of walk(ROUTE_ROOT)) {
    const rel = relative(ROUTE_ROOT, file).split(sep);
    const path =
      "/api/v1/" +
      rel
        .slice(0, -1)
        .join("/")
        .replace(/\[(\w+)\]/g, "{$1}");
    if (excluded.has(path)) continue;
    const load = loaders[`/src/app/api/v1/${rel.join("/")}`];
    if (!load) throw new Error(`glob missed ${file}`);
    const mod = await load();
    for (const method of METHODS) {
      if (typeof mod[method] === "function") {
        out.push({
          key: `${method} ${path}`,
          path,
          method,
          handler: mod[method] as DescribedRouteHandler,
        });
      }
    }
  }
  return out;
}
