export type Envelope = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: { path: string; message: string }[] };
  meta: { requestId: string };
};

export async function envelope(res: Response): Promise<Envelope> {
  return (await res.json()) as Envelope;
}
