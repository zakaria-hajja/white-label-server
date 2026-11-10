#!/usr/bin/env bash
# Writes the base branch's openapi/openapi.json to OUT for the breaking-change check.
# When the base has none (e.g. an app backend's first PR), prints a notice and sets skip=true.
# Usage: scripts/base-openapi.sh <git-ref> <out-file>
set -euo pipefail
ref="$1"
out="$2"
output="${GITHUB_OUTPUT:-/dev/stdout}"
if git show "$ref:openapi/openapi.json" >"$out" 2>/dev/null; then
  echo "skip=false" >>"$output"
else
  rm -f "$out"
  echo "::notice::base has no openapi/openapi.json; skipping breaking-change check"
  echo "skip=true" >>"$output"
fi
