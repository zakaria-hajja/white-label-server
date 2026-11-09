#!/bin/sh
# Runs .githooks/commit-msg --strict on every non-merge commit in BASE..HEAD.
# Used by CI so commits made with --no-verify are still checked.
set -eu

base=${1:?usage: check-commit-messages.sh BASE HEAD}
head=${2:?usage: check-commit-messages.sh BASE HEAD}
msg=$(mktemp)
trap 'rm -f "$msg"' EXIT

# Plain assignment so set -e aborts if the range cannot be resolved.
shas=$(git rev-list --no-merges "$base..$head")

for sha in $shas; do
  git log -1 --format=%B "$sha" > "$msg"
  if ! sh "$(dirname "$0")/../.githooks/commit-msg" --strict "$msg"; then
    echo "check-commit-messages: commit $sha has an invalid message" >&2
    exit 1
  fi
done
echo "check-commit-messages: all commits in $base..$head are valid"
