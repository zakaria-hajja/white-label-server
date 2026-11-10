#!/usr/bin/env bash
# Fails when REVISION breaks the API contract of BASE (see docs/contract.md).
# Runs oasdiff in breaking mode; .oasdiff.yaml (read from the repo root) raises the severity of the
# changes our policy treats as breaking. The one ERR oasdiff reports that the policy allows is a new
# value in the error envelope's `code` enum: clients map unknown codes to UNKNOWN. Both files must
# be inside the current directory. Nothing is uploaded anywhere.
# Usage: scripts/check-breaking.sh <base.json> <revision.json>
set -euo pipefail
base="$1"
revision="$2"
image="tufin/oasdiff:v1.34.1@sha256:67a23cfea7d251e2ae34ee703ac8733c5d96bc2e7b90fd0f4d475ec99367b85f"

changes=$(docker run --rm -v "$PWD:/w" -w /w "$image" breaking "$base" "$revision" --format json)

# A boolean jq predicate: true for a new value in the error envelope's `code` enum.
new_error_code='(.id == "response-property-enum-value-added" and (.text | contains("to the `error/code` response property")))'
allowed=$(jq "[.[] | select(.level == 3 and $new_error_code)] | length" <<<"$changes")
breaking=$(jq -r ".[] | select(.level == 3 and ($new_error_code | not)) | \"\(.operation) \(.path): [\(.id)] \(.text)\"" <<<"$changes")

if [ "$allowed" -gt 0 ]; then
  echo "New error codes (allowed in v1): $(jq -r "[.[] | select($new_error_code) | .text | capture(\"new \`(?<c>[^\`]+)\`\").c] | unique | join(\", \")" <<<"$changes")"
fi
if [ -n "$breaking" ]; then
  echo "Breaking API changes (they need /api/v2; see docs/contract.md):" >&2
  echo "$breaking" >&2
  exit 1
fi
echo "No breaking API changes."
