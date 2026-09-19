#!/bin/sh
# classify-ai-review.sh — decide whether an AI PR-review check may go green, and
# if not, classify WHY and fail visibly (ADR-030; issues #371 Gemini, #388 Claude).
#
# The bug: the review workflows run their review step under `continue-on-error:
# true` so a transient outage doesn't fail the PR. But `continue-on-error` masks
# EVERY failure — a 429 quota/rate-limit exhaustion, a missing/invalid credential,
# or an absent CLI all left the review check GREEN with no review posted. A green
# check that does not prove a review ran defeats the reason the second vendor
# exists.
#
# This is the pure, vendor-neutral decision function, extracted so it can be
# unit-tested off the workflow. The workflow feeds it the review step's `outcome`
# and its error text; this script classifies, writes a job summary, prints a
# one-word token to stdout, and exits non-zero on anything that is not a real
# review — so the check turns RED, never a false green.
#
# Vendor-specific wrappers are thin shims that set REVIEW_VENDOR and exec this:
#   - scripts/classify-gemini-review.sh  (REVIEW_VENDOR=Gemini, issue #371)
#   - scripts/classify-claude-review.sh  (REVIEW_VENDOR=Claude, issue #388)
# The error-marker set below is a SUPERSET covering both vendors' signatures, so
# one classifier serves both without regressing either.
#
# Usage:  REVIEW_VENDOR=<Name> classify-ai-review.sh <outcome> [<error-file>]
#   <outcome>     the GitHub Actions step outcome: success|failure|cancelled|...
#   <error-file>  file with the step's error/stderr text; if omitted, read stdin.
#
# stdout: one classification token — RAN | QUOTA | AUTH | MISSING_CLI | TRANSIENT | UNKNOWN
# exit:   0 only for RAN (a review actually ran); 1 for every other token.
#
# A green check now means, and only means, that a review by REVIEW_VENDOR ran.

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
# Order is precedence: most specific first. Markers cover BOTH vendors:
#   Gemini (run-gemini-cli): TerminalQuotaError, "Gemini CLI not found",
#     "No authentication method", GaxiosError "API key not valid".
#   Claude (claude-code-action / Anthropic API): rate_limit_error [429],
#     authentication_error [401] / invalid x-api-key / OAuth token,
#     overloaded_error [529], "Credit balance is too low".
if match 'cli not found|command not found|not found in \$?path|could not find.*(gemini|claude|cli)|executable.*not found'; then
  token=MISSING_CLI
elif match 'terminalquotaerror|exhausted your daily quota|resource[_ ]exhausted|quota exceeded|exceeded your.*quota|daily quota|rate[_ ]?limit|rate_limit_error|credit balance is too low|usage limit|\b429\b|\[429\]'; then
  token=QUOTA
elif match 'no authentication method|authentication_error|api[_ ]?key not valid|api[_ ]?key[_ ]?invalid|invalid api key|invalid x-api-key|claude_code_oauth_token|oauth[_ ]?token.*(required|missing|expired|invalid|revoked|not provided)|(expired|invalid|revoked).*oauth|missing.*(api key|gemini_api_key|credential|oauth)|gemini_api_key.*(unset|empty|not set|required)|unauthorized|permission[_ ]denied|\b40[13]\b|\[40[13]\]|status.*(401|403)'; then
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
      echo "This check is **advisory** (ADR-030 — AI review never gates merge), but a"
      echo "red result means no ${vendor} review happened, so the second-vendor signal is"
      echo "absent for this run. It is no longer allowed to report a false green."
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

[ "$token" = "RAN" ] && exit 0
exit 1
