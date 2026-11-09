#!/bin/sh
# Applies merge settings and main-branch protection. Safe to re-run.
# Usage: scripts/github-protect.sh [owner/repo]
set -eu

REPO=${1:-zakaria-hajja/white-label-server}

gh api -X PATCH "repos/$REPO" --silent \
  -F allow_merge_commit=true \
  -F allow_squash_merge=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true

gh api -X PUT "repos/$REPO/branches/main/protection" --silent --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["ci"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "github-protect: main protected on $REPO (PR required, check 'ci', admins included)"
