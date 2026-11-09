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

  const capture = (obj: object) => {
    const chunks: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    createLogger("info", dest).info(obj, "x");
    return JSON.parse(chunks.join(""));
  };

  it("redacts nested request shapes", () => {
    const out = capture({
      req: {
        headers: { authorization: "a", cookie: "c" },
        body: { password: "p", newPassword: "n", refreshToken: "r" },
      },
      user: { passwordHash: "h" },
      err: { token: "t" },
    });
    expect(out.req.headers).toEqual({ authorization: "[Redacted]", cookie: "[Redacted]" });
    expect(out.req.body).toEqual({
      password: "[Redacted]",
      newPassword: "[Redacted]",
      refreshToken: "[Redacted]",
    });
    expect(out.user.passwordHash).toBe("[Redacted]");
    expect(out.err.token).toBe("[Redacted]");
  });
});
