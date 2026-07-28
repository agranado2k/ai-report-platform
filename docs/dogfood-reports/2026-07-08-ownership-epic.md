# Dogfood Report: ownership & shareability epic (post-merge, prod)

**Scope**: PRs #143 (G5), #146 (G1 ownership), #150 (G2 org-mode + G3 write grants), #158 (G4 team orgs) + docs #135/#136/#154
**Target**: live prod (`app.centaurspec.com` / `view.centaurspec.com`) at origin/main `a04f9fa`
**Timestamp**: 2026-07-08 ~22:00 UTC
**Mode**: test-against-live; no-fix-on-main (any fix goes through a worktree branch + PR)
**Artifacts**: `.dogfood-state/2026-07-08-ownership-epic.json`, screenshots in `.dogfood-state/shots-2026-07-08/` (local-only on the operator's machine — `.dogfood-state/` is gitignored)

## Summary

✓ Passed: 15 / 16 executed assertions (94%)
✗ Failed: 1 (M7 — scan interstitial served before the ACL gate)
🔧 Auto-fixed: 0 (the one defect is permission-logic → escalation by policy)
⚠️ Escalations: 1 · Paper cuts / observations: 3 · Blocked residuals: 4

## Results

| ID | Persona | Journey | Result | Notes |
|----|---------|---------|--------|-------|
| B1 | anon (browser) | dashboard auth gate | ✓ | `/` → `/sign-in?redirect_url=%2F`, Clerk form renders (screenshot B1) |
| B2 | anon (browser) | private report gate | ✓ | 403, copy: "This report is private — only its owner can view it" (post-ADR-0059 wording live); no content leak (screenshot B2) |
| B3 | anon | health | ✓ | 200 |
| B4 | anon | security headers | ✓/note | viewer: CSP + COOP/CORP + no-referrer + HSTS ✓. App origin: HSTS only — see Observations |
| B5 | anon | owner-open gate | ✓ | 302 → `/` — deliberate anti-existence-oracle (documented in `open-report.server.ts`), no token minted |
| A1–A4 | unauth API | list/upload/acl/write-grants | ✓ | all 401 `application/problem+json` with correct `code` |
| M1 | owner (MCP) | ownership on wire (G1) | ✓ | `reports_get <owner-slug>` → `owner: user_***` + owner-conditional `acl` block (identifiers redacted — public repo) |
| M2 | owner (MCP) | creator-is-owner on upload | ✓ | fresh upload `bfTwXmvJuB` → owner = acting user |
| M3 | owner (MCP) | owner write | ✓ | rename accepted |
| M4 | owner (MCP) | write-grant roster read | ✓/question | 403 "missing required scope: acl:write" — see Observations (read op behind a write scope) |
| M5 | owner (MCP) | G3 scope enforcement | ✓ | `reports_grant_write` → clean 403 missing `acl:write` |
| M6 | owner (MCP) | ACL read (G1 owner-only) | ✓ | `{mode: "private"}` — private-by-default confirmed |
| M7 | anon (browser) | private-by-default gate on fresh upload | ✗ | **mid-scan, anon got HTTP 200 "Scanning…"** for a PRIVATE report; post-scan correctly 302 → unlock → owner-only |
| M7b | anon | post-scan gate | ✓ | 302 → `app.centaurspec.com/unlock/bfTwXmvJuB` |
| M8 | owner (MCP) | owner delete + viewer 410 | ✓ | delete OK; viewer returns 410 Gone |

Probe report `bfTwXmvJuB` was created and deleted by this run; no test data remains.

## Escalation (1)

**Scan interstitial is served before the ACL gate** — `apps/view/app/routes/$slug.tsx`: `resolveViewableReport`'s scan state machine (`scanning` → 200 holding page, ADR-0038 §2) runs BEFORE `resolveAccessDecision` (ADR-0056). While a private report is mid-scan, any anonymous visitor who guesses/possesses the slug gets an HTTP 200 page revealing (a) the slug exists and (b) it is being scanned. No report content is exposed (content is never served until clean), and post-scan a private slug already 302s to the unlock page (existence disclosure inherent to the unlock flow) — so marginal leak is scan-state + a 200-vs-302/404 oracle during the scan window.

*Severity*: Medium-low. *Recommendation*: order the access decision before the scan interstitial for non-public modes (or return the same unlock redirect while scanning). Touches viewer permission logic → per /ce-dogfood policy this is a human decision, not an auto-fix. If approved I'll do it via `/tdd` in a worktree + PR.

*Status (2026-07-27, added when this report was committed)*: **fixed** — PR #170 (`eee7cb2`, fix(viewer): enforce the Acl before the scanning holding page) merged to main with an ADR-0038 amendment; this section is historical record.

## Observations / paper cuts (no action taken)

1. **`reports_list_write_grants` (a read) requires `acl:write`** — an owner with a read-scoped key can *see* their ACL (`reports_get_acl` worked) but not their write-grant roster. Possibly deliberate (roster = share management); if not, `acl:read` would be the natural scope. Design question for ADR-0060's wire contract.
2. **App origin serves no CSP / X-Frame-Options** (only HSTS). Viewer-origin CSP is the ADR-013 focus and is correct; the dashboard origin going CSP-less is a pre-existing hardening gap, not an epic regression. Backlog candidate.
3. **`/open` drops the deep link for a signed-out owner** (302 → `/` → sign-in → dashboard, not back to `/open`). Deliberate anti-oracle collapse per the code comment; a uniform `redirect_url`-preserving variant would keep the property while saving the owner a click. UX nicety only.

## Blocked residuals (need operator / credentials)

1. **Team-org JIT join-or-create in prod** — needs a real corporate-email sign-in (e.g. `arthur@housenumbers.io`); the `+clerk_test` fixture exists only on the dev Clerk instance. CI's team-org smoke covers it against previews.
2. **Org-mode sharing end-to-end** — needs `acl:write` key + a second same-domain member.
3. **Password / allowlist round-trip** — needs an MCP key with `acl:write` (standing item).
4. **Authenticated dashboard UI walkthrough** — no prod test session available to the agent.

## Reproducibility

State: `.dogfood-state/2026-07-08-ownership-epic.json` (operator-local). Replay: re-run the matrix against prod (scenarios are self-contained; M2/M7/M8 create + delete their own probe). Note: at run time, local `main` carried a then-unpushed operator commit `06a4353` (the /ce-dogfood skill docs); it later reached origin via the repo-hygiene PR.
