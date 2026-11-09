import type { Logger } from "pino";
import type { Mailer } from "./mailer";

/** Development mailer: writes the reset link to the log. In production there is no provider, so nothing sensitive is logged. */
export class ConsoleMailer implements Mailer {
  constructor(
    private readonly logger: Logger,
    private readonly nodeEnv: string,
  ) {}

  sendPasswordReset(input: Parameters<Mailer["sendPasswordReset"]>[0]): Promise<void> {
    if (this.nodeEnv === "production") {
      this.logger.warn("reset email suppressed: no mail provider");
    } else {
      this.logger.info(
        {
          to: input.to,
          resetLink: input.resetLink,
          expiresAt: input.expiresAt.toISOString(),
        },
        "password reset email (console mailer)",
      );
    }
    return Promise.resolve();
  }
}
