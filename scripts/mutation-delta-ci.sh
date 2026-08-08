#!/bin/sh
# mutation-delta-ci.sh — the CI half of the ADR-0081 differential mutation
# diagnostic. Runs scripts/mutation-delta.sh over the PR's own changes and
# publishes the summary as ONE pull-request comment.
#
# Usage: scripts/mutation-delta-ci.sh   (no arguments; reads the Actions env)
#
# Requires, from the GitHub Actions environment: GITHUB_EVENT_PATH (the
# pull_request event payload), GITHUB_REPOSITORY, and a `gh` authenticated for
# `pull-requests: write`.
set -eu

MARKER='<!-- mutation-delta -->'
LABEL='mutation-check'

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

: "${GITHUB_EVENT_PATH:?not set — this script runs inside a GitHub Actions pull_request event}"
: "${GITHUB_REPOSITORY:?not set — this script runs inside a GitHub Actions pull_request event}"

event=$GITHUB_EVENT_PATH
action=$(jq -r '.action // empty' "$event")

# THE SPEND GATE, and the whole reason this workflow is not per-push. Two
# actions reach it and they ask different questions:
#
#   labeled      — did THIS event add `mutation-check`? A labelled PR keeps its
#                  label, so `labeled` fires again for every other label anyone
#                  adds; asking "does the PR carry it" here would charge a
#                  mutation run to an event that changed no code.
#   synchronize  — does the PR carry `mutation-check` now? New commits on an
#                  already-labelled PR must re-measure, or the comment describes
#                  a diff that has moved on.
#
# The workflow's job-level `if:` states the same rule in GitHub's expression
# language, where it can stop a runner from starting at all. This copy is the
# one that is executable, and therefore the one under test: it is what keeps the
# rule true if the trigger is ever widened.
if [ "$action" = labeled ]; then
  added=$(jq -r '.label.name // empty' "$event")
  if [ "$added" != "$LABEL" ]; then
    echo "::notice title=Mutation delta::skipped — this event added '$added', not '$LABEL'."
    exit 0
  fi
elif ! jq -e --arg l "$LABEL" '[.pull_request.labels[]?.name] | index($l)' "$event" >/dev/null; then
  echo "::notice title=Mutation delta::skipped — this pull request does not carry the '$LABEL' label."
  exit 0
fi

pr=$(jq -r '.pull_request.number // empty' "$event")
base=$(jq -r '.pull_request.base.sha // empty' "$event")

# Say so rather than sending an empty PR number to the API, where the answer
# would be an ordinary 404 and the cause would be invisible.
if [ -z "$pr" ] || [ -z "$base" ]; then
  echo "::error title=Mutation delta::the event payload names no pull request (number='$pr', base='$base') — this workflow only runs on \`pull_request\`." >&2
  exit 1
fi

# The base commit the PR forked from, not `origin/main`: the checkout is the
# merge commit, so this scopes the run to precisely the PR's own changes.
delta=$("$here/mutation-delta.sh" "$base")
printf '%s\n' "$delta"

body=$(mktemp)
trap 'rm -f "$body"' EXIT
{
  printf '%s\n' "$MARKER"
  printf '## 🧬 Mutation delta\n\n'
  printf '```\n%s\n```\n' "$delta"
  # The reader may be meeting this comment for the first time. A mutation score
  # is not a pass mark, and a score of 83% must not read as a failed gate.
  printf '\n<sub>A **diagnostic, never a gate** (ADR-0081 §1): it gates no merge and is not a required check. '
  printf 'Each survivor is behaviour this branch'"'"'s tests do not enforce — strengthen the test, or say why the mutant is equivalent. '
  printf 'Pushing again refreshes this comment; removing the `%s` label stops it. Locally: `scripts/mutation-delta.sh`.</sub>\n' "$LABEL"
} >"$body"

# ONE comment per pull request, edited in place. Find-by-marker, not
# find-by-author: the token's identity is `github-actions[bot]`, which every
# other workflow in this repo also posts as, and an author match would let this
# script overwrite one of their comments. The marker is an HTML comment, so it
# is invisible in the rendered body.
#
# `--paginate` emits one JSON array per page, and jq filters each of them in
# turn — hence `head -n 1` rather than a slurp.
existing=$(
  gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$pr/comments" |
    jq -r --arg m "$MARKER" 'map(select((.body // "") | contains($m))) | .[0].id // empty' |
    head -n 1
)

payload=$(jq -n --rawfile body "$body" '{body: $body}')
if [ -n "$existing" ]; then
  printf '%s' "$payload" |
    gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" --input - --silent
  echo "::notice title=Mutation delta::updated comment $existing on PR #$pr."
else
  printf '%s' "$payload" |
    gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --input - --silent
  echo "::notice title=Mutation delta::posted the mutation delta on PR #$pr."
fi
