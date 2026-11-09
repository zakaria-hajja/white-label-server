import type { Mailer } from "@/modules/mail/mailer";

type Sent = Parameters<Mailer["sendPasswordReset"]>[0];

/** Records every reset email; `fail` makes the next sends reject. */
export class RecordingMailer implements Mailer {
  sent: Sent[] = [];
  fail = false;

  sendPasswordReset(input: Sent): Promise<void> {
    if (this.fail) return Promise.reject(new Error("mail provider down"));
    this.sent.push(input);
    return Promise.resolve();
  }

  /** The `token` query value of the most recent link. */
  lastToken(): string {
    const last = this.sent.at(-1);
    if (!last) throw new Error("no mail sent");
    return new URL(last.resetLink).searchParams.get("token") ?? "";
  }
}
