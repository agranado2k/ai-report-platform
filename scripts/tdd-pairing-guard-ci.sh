#!/bin/sh
# tdd-pairing-guard-ci.sh — the CI caller of the TDD pairing rule.
#
# Mirror image of `.husky/pre-push`: both are thin callers of the ONE rule in
# scripts/tdd-pairing-guard.sh, and each adds only what its own gate knows —
#
#   .husky/pre-push  resolves a range per pushed ref  · bypass PUSH_WITHOUT_TESTS=1
#   this script      resolves the PR's merge-base range · bypass the `tdd-exempt` PR label
#
# It is a script rather than inline YAML so both of those additions are runnable
# off a GitHub runner: scripts/tdd-pairing-guard-ci.test.ts drives it against
# throwaway repositories and a simulated $GITHUB_EVENT_PATH payload, so the label
# escape hatch is verified without opening a PR to watch it work.
#
# Environment (GitHub Actions supplies all three; see .github/workflows/tdd-pairing.yml):
#   BASE_SHA           the PR's base commit  — github.event.pull_request.base.sha
#   HEAD_SHA           the PR's head commit  — github.event.pull_request.head.sha
#   GITHUB_EVENT_PATH  the event payload; the label list is read from HERE rather
#                      than from the API, so this needs no token and no network.
#
# Exit codes:  0 paired, or exempt · 1 unpaired source change · 2 the gate could
#              not run (missing range, unresolvable merge base). A gate that
#              cannot run must not report green, so 2 fails the job.

set -u

EXEMPT_LABEL=tdd-exempt

[ -n "${BASE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ] || {
  echo "✗ ci: BASE_SHA and HEAD_SHA must be set (the PR's base/head commits)." >&2
  exit 2
}

# The escape hatch, read straight from the event payload. Fails CLOSED: an
# absent or unparseable payload means "not exempt", never "exempt".
if [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "$GITHUB_EVENT_PATH" ] && node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const labels = payload?.pull_request?.labels ?? [];
  process.exit(labels.some((l) => l?.name === process.argv[2]) ? 0 : 1);
' "$GITHUB_EVENT_PATH" "$EXEMPT_LABEL" 2>/dev/null; then
  echo "::notice title=TDD pairing guard::Skipped — this PR carries the \`$EXEMPT_LABEL\` label. The source-changes-need-test-changes rule was NOT enforced here; the label is the record of that choice."
  exit 0
fi

# The MERGE BASE, not BASE_SHA itself: `main` may have moved on since the fork,
# and the rule compares two trees — commits that landed on the base branch after
# the fork point would otherwise read as changes made by this PR (a source file
# advanced on `main` looks "modified" from the PR tree's older copy) and fail a
# PR that never touched it.
base=$(git merge-base "$BASE_SHA" "$HEAD_SHA" 2>/dev/null) || base=
[ -n "$base" ] || {
  echo "✗ ci: cannot find the merge base of $BASE_SHA and $HEAD_SHA (is the checkout shallow? this job needs fetch-depth: 0)." >&2
  exit 2
}

hint="Write the failing test first (/tdd), or label this PR \`$EXEMPT_LABEL\` to override the gate on the record."

sh "$(dirname "$0")/tdd-pairing-guard.sh" "$base" "$HEAD_SHA" --label ci --hint "$hint"
