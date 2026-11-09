# Git Workflow Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce clear commits, branch-per-feature and PR-only merges to `main` for this repo, via written rules, local git hooks, CI and GitHub branch protection.

**Architecture:** Plain POSIX `sh` hooks in `.githooks/` (activated by an npm `prepare` script setting `core.hooksPath`); the `commit-msg` hook is the single implementation of the message rule and CI reuses it. A GitHub Actions job named `ci` is the required status check. A `gh api` script applies branch protection and merge settings idempotently.

**Tech Stack:** POSIX sh, git, Vitest (hook tests, via `node:child_process`), GitHub Actions, `gh` CLI (installed at `/opt/homebrew/bin/gh`).

**Spec:** `docs/superpowers/specs/2026-11-09-git-workflow-design.md`

## Global Constraints

- No new npm dependencies.
- Commit header: `type(scope): summary`, types exactly `feat fix refactor test docs chore ci perf build revert`; scope optional, lowercase kebab-case; optional `!` before `:`; header ≤ 72 chars.
- Headers starting `Merge `, `Revert "`, `fixup! `, `squash! `, `amend! ` bypass the format check.
- Branch names: `feat/ fix/ chore/ docs/ ci/` + lowercase kebab-case. No commits on `main`, no pushes to `main`.
- Merge commits only (squash and rebase merging disabled); head branches auto-deleted.
- Branch protection on `main`: PR required, 0 approvals, required check `ci`, enforced for admins, no force-push, no deletion.
- Claude's commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The owner merges PRs; Claude never uses `--no-verify` unless told to for that instance.
- Repo: `zakaria-hajja/white-label-server` (public). Node version comes from `.nvmrc` (`24`).

## Review Focus

1. **Multi-line commit messages and comment lines** — git passes the full message file (body, `#` comment lines from the editor template); only the first non-comment line is the header. Test in Task 1.
2. **Header exactly 72 chars vs 73** — 72 passes, 73 fails. Test in Task 1.
3. **Uppercase or underscore scope / missing space after colon** (`feat(Auth): x`, `feat(my_mod): x`, `feat:x`) — rejected with a message showing the expected format. Test in Task 1.
4. **Pushing a feature branch to remote `main`** (`git push origin feat/x:main`) — refused by pre-push, since it checks the remote ref, not the local branch name. Test in Task 1.
5. **A `--no-verify` commit inside a PR** — the CI commit-message step fails on it. Verified in Task 3 Step 3.

---

### Task 0: Branch rename and initial `main` push

Must happen before hooks exist (pre-push would refuse the `main` push).

- [ ] **Step 1:** `git branch -m feat/initial-implementation feat/foundation`. Verify: `git branch --show-current` prints `feat/foundation`.
- [ ] **Step 2:** `git push -u origin main`. Verify: `git ls-remote --heads origin` lists `refs/heads/main` at `9d644ef`.
- [ ] **Step 3:** `gh auth status` succeeds (if not, ask the owner to run `! gh auth login`).

### Task 1: Local git hooks

**Files:**
- Create: `.githooks/commit-msg`, `.githooks/pre-commit`, `.githooks/pre-push` (all `chmod +x`, `#!/bin/sh`, `set -eu`)
- Modify: `package.json` (add `"prepare": "git config core.hooksPath .githooks"`)
- Test: `tests/unit/githooks.test.ts`

**Interfaces:**
- Produces: `.githooks/commit-msg <message-file>` — exit 0 if valid, exit 1 with an error on stderr naming the rule broken and showing `type(scope): summary` plus the allowed types. Task 3 calls it from CI.

- [ ] **Step 1: Write failing tests** in `tests/unit/githooks.test.ts`. Helper `runCommitMsg(message: string): { code: number; stderr: string }` writes the message to a temp file and runs `sh .githooks/commit-msg <file>` with `spawnSync`.
  - accepts: `feat(core): add config loader`, `fix: handle null body`, `refactor(auth-guard)!: drop legacy claim`, `revert: undo x`, `Merge pull request #3 from zakaria-hajja/feat/auth`, `fixup! feat(core): add config loader`, a header of exactly 72 chars (`"feat: " + "a".repeat(66)`), and `"# comment\nfeat: real header\n\nbody line"`.
  - rejects (code 1, stderr contains `type(scope): summary`): `wip`, `Added stuff`, `feat:x`, `feat(Auth): x`, `feat(my_mod): x`, `feature: x`, `feat: ` (empty summary), `"feat: " + "a".repeat(67)` (73 chars; stderr contains `72`), empty message.
  - pre-commit: in a temp repo (`git init -b main`), running `sh <abs>/.githooks/pre-commit` with `cwd` = temp repo → code 1, stderr contains `main`; after `git checkout -b feat/x` → code 0.
  - pre-push: stdin `refs/heads/feat/x abc refs/heads/main def\n` → code 1, stderr contains `main` (refusal happens before any npm checks run).
- [ ] **Step 2: Run** `npm run test:unit -- tests/unit/githooks.test.ts`. Expected: FAIL (hook files missing).
- [ ] **Step 3: Implement the hooks.**
  - `commit-msg`: header = first line not starting with `#`; bypass prefixes per Global Constraints; else match `^(feat|fix|refactor|test|docs|chore|ci|perf|build|revert)(\([a-z0-9]+(-[a-z0-9]+)*\))?!?: [^ ].*$` (`grep -Eq`) and `${#header} -le 72`.
  - `pre-commit`: refuse when `git symbolic-ref --short HEAD` is `main`, telling the user to `git switch -c feat/<name>`.
  - `pre-push`: read stdin lines; refuse if any remote ref is `refs/heads/main`. Otherwise run `npm run -s lint && npm run -s typecheck && npm run -s test:unit`.
- [ ] **Step 4: Run** the test file. Expected: PASS. Then `npm install` and verify `git config core.hooksPath` prints `.githooks`.
- [ ] **Step 5: Manual check:** `git commit --allow-empty -m "wip"` is rejected; `git commit --allow-empty -m "chore: hook check"` succeeds, then `git reset --soft HEAD~1`.
- [ ] **Step 6: Commit** `chore(git): commit-msg, pre-commit and pre-push hooks`.

### Task 2: Written rules and PR template

**Files:**
- Create: `CLAUDE.md`, `.github/pull_request_template.md`

- [ ] **Step 1: `CLAUDE.md`** with a `## Git workflow` section: the six rules from spec §"The rules" condensed to ≤ 30 lines, plus a "Phase → PR" line pointing to the implementation plan, and `git log --first-parent main` for the feature-level view. No other sections (YAGNI; `/init` can add more later).
- [ ] **Step 2: PR template** with headings `## What`, `## Why`, `## How tested`, `## Risks & follow-ups`, and a checklist: `- [ ] Commits follow type(scope): summary`, `- [ ] lint, typecheck, tests pass locally`, `- [ ] Docs/plan updated if behaviour changed`.
- [ ] **Step 3: Commit** `docs: git workflow rules and PR template`.

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `.githooks/commit-msg <file>` (Task 1).
- Produces: a job with id `ci` (the required status-check name used in Task 4). Main-plan Task 18 extends this job; it must keep the id `ci` and the commit-message step.

- [ ] **Step 1: Write `ci.yml`:** `on: pull_request` and `push: branches: [main]`; `concurrency` per ref with cancel-in-progress; job `ci` on `ubuntu-latest`: checkout (`fetch-depth: 0`) → setup-node (`node-version-file: .nvmrc`, `cache: npm`) → `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test:unit` → step "Commit messages" (only `if: github.event_name == 'pull_request'`): for each sha in `git rev-list --no-merges ${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }}`, write `git log -1 --format=%B <sha>` to a temp file and run `sh .githooks/commit-msg` on it; print the offending sha and fail on the first error. Pin actions to major tags (`actions/checkout@v5`, `actions/setup-node@v5` or the current majors at execution time).
- [ ] **Step 2: Verify locally:** `npm ci && npm run lint && npm run typecheck && npm run test:unit` exit 0; run the commit-message loop by hand against `main..HEAD` → exit 0.
- [ ] **Step 3: Negative check:** `git commit --allow-empty --no-verify -m "bad message"`, rerun the loop → fails naming that sha; then `git reset --hard HEAD~1`.
- [ ] **Step 4: Commit** `ci: lint, typecheck, unit tests and commit message check`.

### Task 4: GitHub protection, plan update, push

**Files:**
- Create: `scripts/github-protect.sh` (`chmod +x`)
- Modify: `docs/superpowers/plans/2026-11-09-whitelabel-backend-api.md`

- [ ] **Step 1: Write `scripts/github-protect.sh`:** `REPO=${1:-zakaria-hajja/white-label-server}`. (a) `gh api -X PATCH repos/$REPO` with `allow_merge_commit=true allow_squash_merge=false allow_rebase_merge=false delete_branch_on_merge=true`. (b) `gh api -X PUT repos/$REPO/branches/main/protection` with JSON input: `required_status_checks: {strict: false, contexts: ["ci"]}`, `enforce_admins: true`, `required_pull_request_reviews: {required_approving_review_count: 0}`, `restrictions: null`, `allow_force_pushes: false`, `allow_deletions: false`. Safe to re-run.
- [ ] **Step 2: Update the main plan:** insert a "Task 0: Git workflow" pointing to this plan; add a "Phases and PRs" section mapping branches to tasks: `feat/foundation` 1–5, `feat/tenancy` 6–7, `feat/auth-users` 8–12, `feat/modules` 13–15, `feat/security-openapi-ci` 16–18, `docs/guides` 19; each checkpoint ("Report and wait") becomes "push branch, open PR with `gh pr create` using the template, report, wait for the owner to merge, then branch the next phase from updated `main`". Task 18 Step 3 changes from "CI workflow" to "Extend `.github/workflows/ci.yml` (keep job id `ci` and the commit-message step)", and `Create` → `Modify` for that file.
- [ ] **Step 3: Commit** `chore: branch protection script and phase-to-PR plan update`.
- [ ] **Step 4: Push** `git push -u origin feat/foundation` (pre-push hook runs checks). Expected: hook passes, push succeeds.
- [ ] **Step 5: Run** `scripts/github-protect.sh` (outward-facing — confirm with the owner first). Verify: `gh api repos/zakaria-hajja/white-label-server/branches/main/protection --jq '.required_status_checks.contexts, .enforce_admins.enabled'` prints `["ci"]` and `true`; `gh api repos/zakaria-hajja/white-label-server --jq '.allow_squash_merge, .allow_rebase_merge, .delete_branch_on_merge'` prints `false false true`.
- [ ] **Step 6:** Report to the owner. The `feat/foundation` PR is opened at the end of Phase 2 (main-plan Task 5), not now.
