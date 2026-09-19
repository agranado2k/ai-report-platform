#!/bin/sh
# classify-gemini-review.sh — decide whether the Gemini `review` check may go
# green, and if not, classify WHY and fail visibly (ADR-030, issue #371).
#
# The bug: gemini-review.yml runs the review step under `continue-on-error: true`
# so a transient outage doesn't fail the PR. But `continue-on-error` masks EVERY
# failure — a 429 daily-quota exhaustion, a missing GEMINI_API_KEY, or an absent
# CLI all left the `review` check GREEN with no review posted. A green check that
# does not prove a review ran defeats the reason the second vendor exists.
#
# This is the pure decision function, extracted so it can be unit-tested off the
# workflow (scripts/test/classify-gemini-review.test.mjs). The workflow feeds it
# the review step's `outcome` and its `error` output; this script classifies,
# writes a job summary, prints a one-word token to stdout, and exits non-zero on
# anything that is not a real review — so the check turns RED, never a false green.
#
# Usage:  classify-gemini-review.sh <outcome> [<error-file>]
#   <outcome>     the GitHub Actions step outcome: success|failure|cancelled|...
#   <error-file>  file with the step's error/stderr text; if omitted, read stdin.
#
# stdout: one classification token — RAN | QUOTA | AUTH | MISSING_CLI | TRANSIENT | UNKNOWN
# exit:   0 only for RAN (a review actually ran); 1 for every other token.
#
# A green check now means, and only means, that a Gemini review ran.

set -eu

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
# Order is precedence: most specific first.
if match 'gemini cli not found|not found in \$?path|command not found.*gemini|gemini: (command )?not found'; then
  token=MISSING_CLI
elif match 'terminalquotaerror|exhausted your daily quota|resource[_ ]exhausted|quota exceeded|exceeded your.*quota|daily quota'; then
  token=QUOTA
elif match 'no authentication method|api[_ ]?key not valid|api[_ ]?key[_ ]?invalid|invalid api key|missing.*(api key|gemini_api_key|credential)|gemini_api_key.*(unset|empty|not set|required)|unauthorized|permission[_ ]denied|\[40[13]\]|status.*(401|403)'; then
  token=AUTH
elif match 'unavailable|\[50[0-9]\]|status.*(50[0-9])|overloaded|service is currently unavailable|econnreset|etimedout|timed out|deadline[_ ]exceeded|temporarily'; then
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
  RAN)         headline=":white_check_mark: Gemini review ran and posted its result." ;;
  QUOTA)       headline=":no_entry: Gemini review did NOT run — daily quota exhausted (HTTP 429) on the configured model." ;;
  AUTH)        headline=":no_entry: Gemini review did NOT run — an authentication failure (missing or invalid GEMINI_API_KEY / credentials)." ;;
  MISSING_CLI) headline=":no_entry: Gemini review did NOT run — the Gemini CLI was not found." ;;
  TRANSIENT)   headline=":warning: Gemini review did NOT run — a transient upstream outage (5xx / unavailable). Re-run the job to retry." ;;
  UNKNOWN)     headline=":no_entry: Gemini review did NOT run — the step did not complete and the reason was not recognized (outcome: ${outcome:-<none>})." ;;
esac

if [ "${GITHUB_STEP_SUMMARY:-}" != "" ]; then
  {
    echo "### Gemini review check (ADR-030)"
    echo ""
    echo "$headline"
    echo ""
    echo "- Classification: \`${token}\`"
    echo "- Review step outcome: \`${outcome:-<none>}\`"
    if [ "$token" != "RAN" ]; then
      echo ""
      echo "This check is **advisory** (ADR-030 — AI review never gates merge), but a"
      echo "red result means no Gemini review happened, so the second-vendor signal is"
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
