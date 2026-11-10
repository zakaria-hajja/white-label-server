import { z } from "zod";

export const HealthDtoSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["up", "down"]),
});

export type HealthDto = z.infer<typeof HealthDtoSchema>;
