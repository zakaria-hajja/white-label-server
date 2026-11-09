import { pino } from "pino";
import { defaultAppConfig } from "@/core/tenant/tenant-admin.service";
import type { ResetDeps } from "@/modules/auth/auth.service";
import { RecordingMailer } from "./recording-mailer";

/** Password-reset collaborators for tests that do not exercise reset. */
export const resetDeps: ResetDeps = {
  passwordResetTtlMinutes: 30,
  appConfig: { getDocument: () => Promise.resolve(defaultAppConfig("T")) },
  mailer: new RecordingMailer(),
  logger: pino({ level: "silent" }),
};
