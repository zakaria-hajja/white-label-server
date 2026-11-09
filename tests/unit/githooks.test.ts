import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOOKS = resolve(__dirname, "../../.githooks");

function run(hook: string, args: string[], opts: { cwd?: string; input?: string } = {}) {
  const r = spawnSync("sh", [join(HOOKS, hook), ...args], {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
  });
  return { code: r.status, stderr: r.stderr };
}

function runCommitMsg(message: string) {
  const file = join(mkdtempSync(join(tmpdir(), "commit-msg-")), "MSG");
  writeFileSync(file, message);
  return run("commit-msg", [file]);
}

describe("commit-msg hook", () => {
  it.each([
    "feat(core): add config loader",
    "fix: handle null body",
    "refactor(auth-guard)!: drop legacy claim",
    "revert: undo x",
    "Merge pull request #3 from zakaria-hajja/feat/auth",
    'Revert "feat(core): add config loader"',
    "fixup! feat(core): add config loader",
    "feat: " + "a".repeat(66),
    "# comment\nfeat: real header\n\nbody line",
  ])("accepts %j", (msg) => {
    expect(runCommitMsg(msg).code).toBe(0);
  });

  it.each([
    "wip",
    "Added stuff",
    "feat:x",
    "feat(Auth): x",
    "feat(my_mod): x",
    "feature: x",
    "feat: ",
    "",
  ])("rejects %j", (msg) => {
    const r = runCommitMsg(msg);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("type(scope): summary");
  });

  it("rejects a 73-char header and mentions the limit", () => {
    const r = runCommitMsg("feat: " + "a".repeat(67));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("72");
  });
});

describe("pre-commit hook", () => {
  it("refuses commits on main and allows feature branches", () => {
    const repo = mkdtempSync(join(tmpdir(), "repo-"));
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    const onMain = run("pre-commit", [], { cwd: repo });
    expect(onMain.code).toBe(1);
    expect(onMain.stderr).toContain("main");
    spawnSync("git", ["checkout", "-q", "-b", "feat/x"], { cwd: repo });
    expect(run("pre-commit", [], { cwd: repo }).code).toBe(0);
  });
});

describe("pre-push hook", () => {
  it("refuses a push targeting remote main", () => {
    const r = run("pre-push", ["origin", "url"], {
      input: "refs/heads/feat/x abc refs/heads/main def\n",
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("main");
  });
});

describe("commit-msg hook: review fixes", () => {
  it("counts characters, not bytes, regardless of locale", () => {
    const file = join(mkdtempSync(join(tmpdir(), "commit-msg-")), "MSG");
    writeFileSync(file, "feat: café " + "a".repeat(61)); // 72 characters, 73 bytes
    const r = spawnSync("sh", [join(HOOKS, "commit-msg"), file], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    expect(r.status).toBe(0);
  });

  it.each(["fixup! feat: x", "squash! feat: x", "amend! feat: x", "Merge stuff"])(
    "rejects %j in --strict mode (CI)",
    (msg) => {
      const file = join(mkdtempSync(join(tmpdir(), "commit-msg-")), "MSG");
      writeFileSync(file, msg);
      expect(run("commit-msg", ["--strict", file]).code).toBe(1);
    },
  );

  it("accepts a valid header in --strict mode", () => {
    const file = join(mkdtempSync(join(tmpdir(), "commit-msg-")), "MSG");
    writeFileSync(file, "feat: x");
    expect(run("commit-msg", ["--strict", file]).code).toBe(0);
  });
});

describe("check-commit-messages script", () => {
  it("fails when the range cannot be resolved", () => {
    const r = spawnSync(
      "sh",
      [resolve(__dirname, "../../scripts/check-commit-messages.sh"), "deadbeef".repeat(5), "HEAD"],
      {
        encoding: "utf8",
      },
    );
    expect(r.status).not.toBe(0);
  });
});
