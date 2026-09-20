#!/bin/sh
# classify-ai-review.sh — decide whether an AI PR-review check may go green, and
# if not, classify WHY and fail visibly (ADR-030; #388 Claude, #394 Gemini retired).
#
# The bug: the review workflows run their review step under `continue-on-error:
# true` so a transient outage doesn't fail the PR. But `continue-on-error` masks
# EVERY failure — a 429 quota/rate-limit exhaustion, a missing/invalid credential,
# or an absent CLI all left the review check GREEN with no review posted. A green
# check that does not prove a review ran defeats the reason AI review exists.
#
# This is the pure, vendor-neutral decision function, extracted so it can be
# unit-tested off the workflow. The workflow feeds it the review step's `outcome`
# and its error text; this script classifies, writes a job summary, prints a
# one-word token to stdout, and exits non-zero on anything that is not a real
# review — so the check turns RED, never a false green.
#
# Vendor-specific wrappers are thin shims that set REVIEW_VENDOR and exec this:
#   - scripts/classify-claude-review.sh  (REVIEW_VENDOR=Claude, issue #388)
# AI review is single-vendor (Claude) today: the Gemini reviewer was retired in
# #394 because Google deprecated its model. This classifier stays deliberately
# VENDOR-NEUTRAL — its error-marker set is a generic superset, not Claude-only —
# so a different second vendor can be reintroduced later behind this same seam by
# adding a shim (REVIEW_VENDOR=<Name>) and any markers unique to it. See ADR-030.
#
# Usage:  REVIEW_VENDOR=<Name> classify-ai-review.sh <outcome> [<error-file>]
#   <outcome>     the GitHub Actions step outcome: success|failure|cancelled|...
#   <error-file>  file with the step's error/stderr text; if omitted, read stdin.
#
# stdout: one classification token —
#         RAN | TRUNCATED | QUOTA | AUTH | MISSING_CLI | TRANSIENT | UNKNOWN
# exit:   0 for RAN and TRUNCATED (a review actually ran — TRUNCATED means it ran
#         but the reviewer hit its turn cap and the result may be incomplete);
#         1 for every other token (no review ran).
#
# A green check now means, and only means, that a review by REVIEW_VENDOR ran
# (possibly truncated). Truncated-with-a-note is still a review; truncated with
# nothing posted is not, and stays red.

set -eu

vendor=${REVIEW_VENDOR:-AI}
outcome=${1:-}

if [ "${2:-}" != "" ]; then
  err=$(cat "$2" 2>/dev/null || true)
else
  err=$(cat || true)
fi

# match <pattern> — case-insensitive extended-regex test against the error text.
match() {
  printf '%s' "$err" | grep -iqE "$1"
}

# Classify. Error-text markers win over the step outcome (belt and suspenders:
# the action can swallow an error and still exit 0 — the ticket's re-run case),
# so a known failure signature is always caught even on a "success" outcome.
# Order is precedence: most specific first. The active vendor is Claude
# (claude-code-action / Anthropic API): rate_limit_error [429],
# authentication_error [401] / invalid x-api-key / OAuth token,
# overloaded_error [529], "Credit balance is too low". The remaining markers are
# generic (quota / auth / 5xx phrasings, not tied to any one vendor) and are kept
# on purpose: they are the vendor-neutral seam a future second reviewer plugs into.
# TRUNCATED is decided FIRST (issue #394). The reviewer hit its per-run turn
# ceiling — the Claude SDK result subtype `error_max_turns`. That is NOT a hard
# failure like quota/auth: if a review body was still posted before the ceiling,
# the AI-review signal exists (just possibly incomplete), so the check goes GREEN
# with a note. Only a turn cap that posted NOTHING is a real no-review and stays
# red. Deciding it first also means the posted review body — model-authored and,
# per ADR-0069, untrusted — can never trip the QUOTA/AUTH/TRANSIENT markers below.
if match 'error_max_turns|maximum number of turns|max[ _-]?turns|reached.*turn limit'; then
  # Body present? Lowercase first (portable — no GNU-only `sed` I flag), strip the
  # turn-cap markers, then all whitespace/punctuation. Anything left is the posted
  # (partial) review the workflow fed alongside the subtype.
  rest=$(printf '%s' "$err" | tr 'A-Z' 'a-z' \
    | sed -e 's/error_max_turns//g' \
          -e 's/maximum number of turns//g' \
          -e 's/max[ _-]*turns//g' \
          -e 's/reached the turn limit//g' \
    | tr -d '[:space:][:punct:]')
  if [ -n "$rest" ]; then
    token=TRUNCATED
  else
    # Hit the cap with nothing posted — a real no-review.
    token=UNKNOWN
  fi
elif match 'cli not found|command not found|not found in \$?path|could not find.*(claude|cli)|executable.*not found'; then
  token=MISSING_CLI
elif match 'exhausted your daily quota|resource[_ ]exhausted|quota exceeded|exceeded your.*quota|daily quota|rate[_ ]?limit|rate_limit_error|credit balance is too low|usage limit|\b429\b|\[429\]'; then
  token=QUOTA
elif match 'no authentication method|authentication_error|api[_ ]?key not valid|api[_ ]?key[_ ]?invalid|invalid api key|invalid x-api-key|claude_code_oauth_token|oauth[_ ]?token.*(required|missing|expired|invalid|revoked|not provided)|(expired|invalid|revoked).*oauth|missing.*(api key|credential|oauth)|unauthorized|permission[_ ]denied|\b40[13]\b|\[40[13]\]|status.*(401|403)'; then
  token=AUTH
elif match 'unavailable|overloaded_error|overloaded|\b5[0-9][0-9]\b|\[5[0-9][0-9]\]|status.*(5[0-9][0-9])|service is currently unavailable|econnreset|etimedout|timed out|deadline[_ ]exceeded|temporarily'; then
  token=TRANSIENT
elif [ "$outcome" = "success" ]; then
  token=RAN
else
  # Any non-success outcome with no recognized signature: still not a review.
  token=UNKNOWN
fi

# Human-readable summary line per token. Quota and auth are deliberately worded
# so they are unambiguous and never share phrasing (AC: quota distinguishable
# from auth in the summary).
case "$token" in
  RAN)         headline=":white_check_mark: ${vendor} review ran and posted its result." ;;
  TRUNCATED)   headline=":warning: ${vendor} review ran but was truncated at max turns — it posted a result that may be incomplete." ;;
  QUOTA)       headline=":no_entry: ${vendor} review did NOT run — quota/rate-limit exhausted (HTTP 429) on the configured model." ;;
  AUTH)        headline=":no_entry: ${vendor} review did NOT run — an authentication failure (a missing or invalid credential: token / API key)." ;;
  MISSING_CLI) headline=":no_entry: ${vendor} review did NOT run — the ${vendor} review action / CLI was not found." ;;
  TRANSIENT)   headline=":warning: ${vendor} review did NOT run — a transient upstream outage (5xx / unavailable / overloaded). Re-run the job to retry." ;;
  UNKNOWN)     headline=":no_entry: ${vendor} review did NOT run — the step did not complete and the reason was not recognized (outcome: ${outcome:-<none>})." ;;
esac

if [ "${GITHUB_STEP_SUMMARY:-}" != "" ]; then
  {
    echo "### ${vendor} review check (ADR-030)"
    echo ""
    echo "$headline"
    echo ""
    echo "- Classification: \`${token}\`"
    echo "- Review step outcome: \`${outcome:-<none>}\`"
    if [ "$token" != "RAN" ]; then
      echo ""
      if [ "$token" = "TRUNCATED" ]; then
        echo "This check is **advisory** (ADR-030 — AI review never gates merge). The review"
        echo "ran and posted a result, but ${vendor} hit its per-run turn cap"
        echo "(\`--max-turns\`), so the review **may be incomplete** — the check is green with"
        echo "this note rather than red. Raising the turn budget makes this rare; re-run for a"
        echo "full pass if the truncated review looks partial."
      else
        echo "This check is **advisory** (ADR-030 — AI review never gates merge), but a"
        echo "red result means no ${vendor} review happened, so the AI-review signal is"
        echo "absent for this run. It is no longer allowed to report a false green."
      fi
      if [ "$err" != "" ]; then
        echo ""
        echo "<details><summary>Reviewer step error output</summary>"
        echo ""
        echo '```'
        printf '%s\n' "$err" | head -c 4000
        echo '```'
        echo ""
        echo "</details>"
      fi
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

printf '%s\n' "$token"

# RAN and TRUNCATED both mean a review actually ran (TRUNCATED = ran but hit the
# turn cap, so possibly incomplete) — green. Everything else is red.
case "$token" in
  RAN | TRUNCATED) exit 0 ;;
esac
exit 1
