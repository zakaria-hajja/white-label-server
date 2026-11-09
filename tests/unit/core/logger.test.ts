import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "@/core/logging/logger";

describe("createLogger", () => {
  it("redacts sensitive fields", () => {
    const chunks: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger("info", dest);
    log.info({ password: "x", refreshToken: "y", headers: { authorization: "z" } }, "hi");
    const out = JSON.parse(chunks.join(""));
    expect(out.password).toBe("[Redacted]");
    expect(out.refreshToken).toBe("[Redacted]");
    expect(out.headers.authorization).toBe("[Redacted]");
  });
});
