import { HealthDtoSchema } from "../http/health";
import { SuccessEnvelope, registerOperation } from "./components";
import { registry, TAGS } from "./registry";
import { healthExamples } from "./system.examples";

export const HealthEnvelope = SuccessEnvelope(
  "HealthEnvelope",
  registry.register("HealthDto", HealthDtoSchema),
);

registerOperation({
  method: "get",
  path: "/api/v1/health",
  operationId: "healthGet",
  tag: TAGS.system,
  summary: "Liveness and database check",
  description:
    'A database outage still returns the envelope, with HTTP 503 and data.status "degraded".',
  auth: "none",
  tenant: "none",
  success: [
    { status: 200, description: "Healthy", schema: HealthEnvelope, example: healthExamples.ok },
    {
      status: 503,
      description: "Database unreachable",
      schema: HealthEnvelope,
      example: healthExamples.degraded,
    },
  ],
});
