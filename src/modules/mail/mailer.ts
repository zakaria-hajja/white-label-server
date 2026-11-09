export interface Mailer {
  sendPasswordReset(input: {
    to: string;
    tenantName: string;
    resetLink: string;
    expiresAt: Date;
  }): Promise<void>;
}
