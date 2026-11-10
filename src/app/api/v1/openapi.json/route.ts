import { route } from "@/core/http/route";
import spec from "../../../../../openapi/openapi.json";

export const runtime = "nodejs";

// Serves the committed contract as-is: not enveloped, no tenant, no auth.
export const GET = route({
  auth: "none",
  tenant: "none",
  handler: () =>
    Promise.resolve(
      new Response(JSON.stringify(spec), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
      }),
    ),
});
