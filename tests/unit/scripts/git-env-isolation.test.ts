import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Git exports GIT_DIR to hooks when you push from a linked worktree, so the pre-push hook runs
// the unit tests with it set. Tests that create their own git repos must still only touch those
// repos. This runs them with GIT_DIR pointing at a decoy repo and checks that the decoy is unchanged.
const GIT_TESTS = ["tests/unit/githooks.test.ts", "tests/unit/scripts/base-openapi.test.ts"];

const decoy = mkdtempSync(join(tmpdir(), "decoy-"));
const git = (...args: string[]) =>
  execFileSync("git", ["-C", decoy, ...args], { encoding: "utf8", stdio: "pipe" }).trim();

afterAll(() => rmSync(decoy, { recursive: true, force: true }));

describe("unit tests with an inherited GIT_DIR", () => {
  it("leave the enclosing repo alone", () => {
    git("init", "-q", "-b", "main");
    writeFileSync(join(decoy, "README"), "decoy");
    git("add", ".");
    git(
      "-c",
      "user.name=decoy",
      "-c",
      "user.email=decoy@example.invalid",
      "commit",
      "-q",
      "-m",
      "decoy",
    );
    const head = git("rev-parse", "HEAD");

    const r = spawnSync("npx", ["vitest", "run", "--project", "unit", ...GIT_TESTS], {
      cwd: resolve(__dirname, "../../.."),
      env: { ...process.env, GIT_DIR: join(decoy, ".git") },
      encoding: "utf8",
    });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("tag")).toBe("");
    expect(git("config", "--local", "core.bare")).toBe("false");
    expect(spawnSync("git", ["-C", decoy, "config", "--local", "user.email"]).status).not.toBe(0);
  }, 60_000);
});
