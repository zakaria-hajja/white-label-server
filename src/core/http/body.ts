import { AppError } from "../errors/app-error";

/**
 * Reads and parses a JSON body, enforcing maxBytes on the bytes actually read
 * (Content-Length is only used as an early reject, never trusted).
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_ERROR", "Content-Type must be application/json");
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body is not valid JSON");
  }
}

function tooLarge(maxBytes: number): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`);
}
