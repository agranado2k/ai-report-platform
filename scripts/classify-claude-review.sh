#!/bin/sh
# classify-claude-review.sh — thin vendor shim (issue #388). The Claude
# `claude-review` check's fail-visibly gate. All logic lives in the shared
# classifier; this only pins the vendor name so the job summary reads "Claude".
# See scripts/classify-ai-review.sh and ADR-030 (the #388 amendment).
#
# Usage:  classify-claude-review.sh <outcome> [<error-file>]
#   error text on stdin if no <error-file>. The Claude action has no
#   `outputs.error`, so the gate step in claude-code-review.yml extracts the
#   error-bearing fields from `outputs.execution_file` and pipes them here.
set -eu
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REVIEW_VENDOR=Claude exec "$dir/classify-ai-review.sh" "$@"
