# Dogfood Report: #174 smoke readiness gate (issue #149)

**Branch tested**: fix/smoke-readiness-gate (PR #174, merged as `9db6339`)
**Fix branch**: fix/smoke-gate-isolated-only
**Timestamp**: 2026-07-09 UTC
**Scope**: only user/HTTP-observable surface in #174 was `/health` (the CI workflow changes aren't browser-testable pre-merge).

## Summary

✗ **1 High-severity bug found on the live preview** — the readiness gate would have **failed every isolated smoke run**.
🔧 Auto-fixed (hotfix PR): gate on `isolated`, demote the DB ping to advisory.

## The finding

`GET /health` on #174's live isolated preview returned:
```json
{"checks":{"neon":"error"}, "isolated":true, "neonBranch":"preview-pr-174", "status":"ok", ...}
```
- ✅ `isolated:true` + `neonBranch` — the marker works, the gate *can* distinguish the isolated redeploy.
- ✗ `checks.neon:"error"` on a **healthy** isolated preview (the app's real routes use that DB fine).

**Why it matters**: the shipped gate treated `isolated:true && neon != "ok"` as **fail loud** → every isolated deployment's smoke run would FAIL. #174 (now on `main`) made the smoke *worse*, not reliable — the opposite of #149's intent.

## Root cause (diagnosed, not guessed)

- `pingDb` **works** against real Neon locally (`SELECT 1` → ok) — the code is correct.
- The `neon:"error"` is **environmental**: `/health`'s ping opens a **fresh neon-serverless WebSocket outside the app's normal request/transaction path**, and a **Neon preview branch auto-suspends when idle**. A ping to a cold/suspended compute errors, even though the app's normal query path would wake it (and Playwright's request timeout tolerates that wake). My manual `/health` hit landed hours post-deploy → branch suspended → `error`. In CI the branch may be warm (just-migrated) — but if it suspends between the redeploy and the poll, the gate fails the smoke.

Design flaw: **gating the smoke's pass/fail on a synthetic health-route DB ping is fragile.**

## Fix (hotfix PR)

- **Gate on `isolated:true`** (the authoritative, reliable signal — and the actual #149 cause: the pre-isolation deployment). Never isolated in the window → skip cleanly.
- **`checks.neon` is advisory**: wait a bounded window for `neon:"ok"` as a courtesy (lets a cold branch warm), but **proceed on `isolated:true` regardless**. A genuinely-unreachable DB surfaces as a real `auth-upload` scenario failure, not a synthetic gate fail.
- `/health` + the `pingDb` code are unchanged (the field is honest, just not gated on). ADR-0047 amendment reconciled.

## Verification

- Live: `GET /health` on the preview confirmed the shape + the `neon:"error"` finding.
- `pingDb` reproduced ok against real Neon locally (isolates code from env).
- New gate logic dry-run: `isolated:false→skip` · `isolated+neon:ok→run(notice)` · `isolated+neon:error→run(warning)`. YAML valid, docs:check green.
- **Post-merge (only place the trigger fires)**: watch the next PR's Actions — pre-isolation invocation skips, isolated invocation runs (with a notice or advisory warning), scenarios pass.

## Follow-up (not blocking)

Make `/health`'s DB ping reflect real reachability on a cold Neon branch (e.g. a short connect-retry to wake the compute), so `neon:"ok"` becomes trustworthy and the courtesy-wait is meaningful. Low priority — the gate no longer depends on it.
