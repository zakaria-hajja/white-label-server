import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import pkg from "../../../package.json";
import { registry, TAG_DESCRIPTIONS, TAGS } from "./registry";
// Importing the modules registers their operations (side effect). Add new modules here.
import "./components";
import "./system.openapi";
import "@/modules/auth/auth.openapi";
import "@/modules/users/users.openapi";
import "@/modules/settings/settings.openapi";
import "@/modules/catalog/catalog.openapi";
import "@/modules/app-config/app-config.openapi";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const TOP_LEVEL_ORDER = ["openapi", "info", "servers", "tags", "paths", "components"];

/** Sorts object keys recursively (arrays keep their order) so regeneration is byte-stable. */
function sortKeys(value: Json, top = false): Json {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v));
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => {
      if (top) {
        const ia = TOP_LEVEL_ORDER.indexOf(a);
        const ib = TOP_LEVEL_ORDER.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return Object.fromEntries(keys.map((k) => [k, sortKeys(value[k] as Json)]));
  }
  return value;
}

/**
 * registerParameter() also emits a `components.schemas.<name>` entry per header parameter, which
 * client generators would turn into pointless model classes; inline them as plain strings.
 */
function inlineParameterSchemas(doc: Json): void {
  const c = (
    doc as { components: { schemas: Record<string, Json>; parameters: Record<string, Json> } }
  ).components;
  for (const param of Object.values(c.parameters)) {
    const p = param as { schema: Json };
    const ref = (p.schema as { $ref?: string }).$ref;
    if (ref?.startsWith("#/components/schemas/")) {
      p.schema = { type: "string" };
      delete c.schemas[ref.slice("#/components/schemas/".length)];
    }
  }
}

export function buildOpenApiDocument() {
  const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Whitelabel Backend API",
      version: pkg.version,
      description:
        "Multi-tenant REST API for white-label mobile apps. Every JSON response uses the " +
        "`{success, data, meta}` / `{success:false, error, meta}` envelope. Send `X-Client-Id` on " +
        "every request; authenticate with `Authorization: Bearer <accessToken>`.",
    },
    servers: [{ url: "/" }],
    tags: Object.values(TAGS).map((name) => ({ name, description: TAG_DESCRIPTIONS[name] })),
  });
  inlineParameterSchemas(doc as unknown as Json);
  return sortKeys(doc as unknown as Json, true) as unknown as typeof doc;
}
