#!/usr/bin/env bash
# Writes the base branch's openapi/openapi.json to OUT for the breaking-change check.
# When the base has none (e.g. an app backend's first PR), prints a notice and sets skip=true.
# Any other failure (the ref doesn't resolve, git can't read the file) fails the step, so a broken
# checkout never silently skips the check.
# Usage: scripts/base-openapi.sh <git-ref> <out-file>
set -euo pipefail
ref="$1"
out="$2"
path="openapi/openapi.json"
output="${GITHUB_OUTPUT:-/dev/stdout}"
if ! commit="$(git rev-parse --verify --quiet "$ref^{commit}")"; then
  echo "::error::base ref '$ref' does not resolve to a commit" >&2
  exit 1
fi
if [ -z "$(git ls-tree "$commit" -- "$path")" ]; then
  rm -f "$out"
  echo "::notice::base has no $path; skipping breaking-change check"
  echo "skip=true" >>"$output"
  exit 0
fi
git show "$commit:$path" >"$out"
echo "skip=false" >>"$output"
