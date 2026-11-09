# Git Workflow Rules — Design

Status: **awaiting approval**. Date: 2026-11-09. Size: small change.

## Intent

Keep the repo clean and well structured: clear commits, a proper branch and PR for each
big feature. The rules apply to two people — the owner and Claude — so they must be both
readable (Claude reads them every session) and enforced (slips get caught, not just
discouraged).

**Goals:** readable history on `main`; every change to `main` arrives through a PR that
passed CI; rules that cost nothing to follow day to day.
**Non-goals:** required PR approvals (single human reviewer), release/versioning
automation, changelog generation.
**Anti-goals:** new dependencies or config for what fits in a few lines of shell; rules
that only exist on paper.

## Decisions (owner's)

- **Enforcement level 3:** written rules + local git hooks + GitHub branch protection with
  required CI.
- **Branch granularity:** one branch/PR per plan phase or user-visible capability; small
  fixes get their own short branch.
- **Merge style:** merge commits only (squash and rebase merging disabled). Full per-commit
  history kept; `git log --first-parent main` gives the one-line-per-feature view.
- **Implementation approach A:** plain git hooks in `.githooks/`, no new npm dependencies.

## Approaches considered

- **A. Plain git hooks + `.github/` + `gh` (chosen).** ~30 lines of shell, zero deps,
  matches the project's "no abstraction without a reason" anti-goal. Error messages are
  hand-written.
- **B. husky + commitlint.** Battle-tested parsing and nicer errors; costs 2–3 dev deps
  and a config file for a one-line rule.
- **C. CI-only checks.** Simplest, but bad messages are found only after pushing.

## The rules

1. **Commits** — Conventional Commits: `type(scope): summary`. Types: `feat fix refactor
   test docs chore ci perf build revert`. Scope optional, lowercase kebab-case. Summary in
   imperative mood, header ≤ 72 chars. Body explains *why* when not obvious. One logical
   change per commit. Claude's commits end with its `Co-Authored-By` trailer.
2. **Branches** — never commit to `main`. Names: `feat/<feature>`, `fix/<thing>`,
   `chore/<thing>`, `docs/<thing>`, `ci/<thing>` (lowercase kebab-case).
3. **Before pushing** — `lint`, `typecheck`, `test:unit` pass (enforced by pre-push hook).
   Integration tests run in CI (they need Postgres).
4. **PRs** — one per phase/feature, using the PR template (what, why, how tested, risks).
   CI must be green. Merged with a merge commit; head branch auto-deleted.
5. **History rewriting** — never force-push `main`. On your own feature branch, only
   `git push --force-with-lease`, and only before the PR is reviewed.
6. **Claude specifically** — branches, commits, pushes and opens PRs as part of planned
   work; **the owner merges**. Claude never bypasses hooks (`--no-verify`) unless the
   owner says so for that instance.

## What gets built

| File | Purpose |
|------|---------|
| `CLAUDE.md` → "Git workflow" section | The rules above, short; the single written source. |
| `.githooks/commit-msg` | Rejects headers not matching the format or > 72 chars. Lets `Merge …`, `Revert …`, `fixup!`/`squash!` through. |
| `.githooks/pre-commit` | Refuses commits while on `main`. |
| `.githooks/pre-push` | Refuses pushes to `main`; runs `lint`, `typecheck`, `test:unit`. |
| `package.json` `prepare` script | `git config core.hooksPath .githooks` — hooks install on `npm install`. |
| `.github/workflows/ci.yml` | On PR + push to `main`: `npm ci`, lint, typecheck, `test:unit`, and a commit-message check over the PR's commits (catches `--no-verify`). Job name `ci` is the required check. Task 18 later extends it (Postgres service, integration suites, build, Docker). |
| `.github/pull_request_template.md` | What / Why / How tested / Risks & follow-ups. |
| `scripts/github-protect.sh` | Idempotent `gh api` calls: protect `main` (require PR, require `ci` check, 0 approvals, enforce for admins, block force-push and deletion); repo settings (merge commits only, delete head branches on merge). |

## Rollout (Claude's call, open to correction)

1. Rename `feat/initial-implementation` → `feat/foundation`.
2. Push `main` as it is today (the docs commit) — protection needs the branch to exist.
3. Build the files above as the first task of `feat/foundation` (CI must exist before
   anything can require it). Commit `chore: git workflow rules, hooks and CI`.
4. Owner installs and authenticates `gh` (`brew install gh`, `! gh auth login`); Claude
   runs `scripts/github-protect.sh`.
5. Update the implementation plan: insert this as Task 0, map phases to PRs (foundation
   1–5, tenancy 6–7, auth-and-users 8–12, modules 13–15, security-openapi-ci 16–18, docs
   19), and change Task 18 to "extend CI" rather than create it. Open a PR at each phase
   checkpoint.

## Left to the builder

Exact regex and error wording in hooks; CI caching details; Node version in CI read from
`.nvmrc`.
