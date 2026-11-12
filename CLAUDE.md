# CLAUDE.md

## Git workflow

Applies to everyone working in this repo (the owner and Claude). Enforced by `.githooks/`
(installed by `npm install`) and CI (`.github/workflows/ci.yml`, job `ci`). The repo is public,
so GitHub enforces branch protection on `main` too: changes land through a PR, the `ci` check
must pass before merging (admins included), and force-pushes and deletion are blocked.
`scripts/github-protect.sh` applies these settings; re-run it if they drift.
Design: `docs/superpowers/specs/2026-11-09-git-workflow-design.md`.

1. **Commits** — Conventional Commits: `type(scope): summary`.
   - Types: `feat fix refactor test docs chore ci perf build revert`.
   - Scope optional, lowercase kebab-case. Summary in imperative mood. Header ≤ 72 chars.
   - Body explains *why* when it isn't obvious. One logical change per commit.
   - Claude's commits end with its `Co-Authored-By` trailer.
2. **Branches** — never commit to `main`. Names: `feat/`, `fix/`, `chore/`, `docs/`, `ci/`
   + lowercase kebab-case. One branch per plan phase or user-visible capability; small
   fixes get their own short branch.
3. **Before pushing** — `lint`, `typecheck` and `test:unit` pass (the pre-push hook runs
   them). Integration suites run in CI.
4. **PRs** — one per phase/feature, filled in from the PR template, CI green. Merged with a
   merge commit (squash/rebase are disabled); the head branch is deleted on merge.
   `git log --first-parent main` gives the one-line-per-feature view.
5. **History** — never force-push `main`. On your own feature branch, only
   `git push --force-with-lease`, and only before the PR is reviewed.
6. **Claude** — branches, commits, pushes and opens PRs (`gh pr create`) as part of
   planned work; **the owner merges**. Never bypass hooks (`--no-verify`) unless the owner
   says so for that instance.

Phase → branch mapping for the initial build: see "Phases and PRs" in
`docs/superpowers/plans/2026-11-09-whitelabel-backend-api.md`.
