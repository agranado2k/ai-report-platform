#!/bin/sh
# classify-gemini-review.sh — thin vendor shim (issue #371). The Gemini `review`
# check's fail-visibly gate. All logic lives in the shared classifier; this only
# pins the vendor name so the job summary reads "Gemini". Generalized in #388,
# when the identical false-green was fixed for the Claude check — one classifier
# now serves both vendors. See scripts/classify-ai-review.sh and ADR-030.
#
# Usage:  classify-gemini-review.sh <outcome> [<error-file>]
#   error text on stdin if no <error-file>. gemini-review.yml pipes
#   `steps.gemini.outputs.error` in.
set -eu
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REVIEW_VENDOR=Gemini exec "$dir/classify-ai-review.sh" "$@"
