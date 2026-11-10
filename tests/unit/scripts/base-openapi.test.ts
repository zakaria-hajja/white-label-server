import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/base-openapi.sh");
let repo: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });

function run(ref: string) {
  const out = join(repo, "base.json");
  const ghOutput = join(repo, "gh-output");
  writeFileSync(ghOutput, "");
  const r = spawnSync("bash", [SCRIPT, ref, out], {
    cwd: repo,
    env: { ...process.env, GITHUB_OUTPUT: ghOutput },
    encoding: "utf8",
  });
  return { status: r.status, output: readFileSync(ghOutput, "utf8"), stdout: r.stdout, out };
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "base-openapi-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  writeFileSync(join(repo, "README"), "x");
  git("add", ".");
  git("commit", "-q", "-m", "no spec");
  git("tag", "no-spec");
  mkdirSync(join(repo, "openapi"));
  writeFileSync(join(repo, "openapi/openapi.json"), '{"openapi":"3.1.0"}');
  git("add", ".");
  git("commit", "-q", "-m", "spec");
  git("tag", "with-spec");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("scripts/base-openapi.sh", () => {
  it("writes the base spec when the base has one", () => {
    const r = run("with-spec");
    expect(r.status).toBe(0);
    expect(r.output).toBe("skip=false\n");
    expect(readFileSync(r.out, "utf8")).toBe('{"openapi":"3.1.0"}');
  });

  it("skips with a notice when the base has no spec", () => {
    const r = run("no-spec");
    expect(r.status).toBe(0);
    expect(r.output).toBe("skip=true\n");
    expect(r.stdout).toContain("::notice::");
  });

  it("fails, instead of skipping the check, when the base ref doesn't resolve", () => {
    const r = run("origin/does-not-exist");
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain("skip=true");
  });
});
