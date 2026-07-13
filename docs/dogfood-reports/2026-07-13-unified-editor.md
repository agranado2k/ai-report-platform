# Dogfood Report: unified in-viewer editor (rounds 1+2)

**Target**: the merged unified-editor surface on `view.centaurspec.com/<slug>/edit` (ADR-0063)
**Branch/commit**: `main` @ `7fde31f` (all of #189–#201 merged)
**Timestamp**: 2026-07-13 ~14:10 UTC
**Method**: **live-prod adaptation** — the `/ce-dogfood` skill is branch-diff oriented and refuses on trunk; everything here is already merged, so instead of a branch diff this run verifies the **deployed** surface: prod health + a read-only inventory of the real production data-plane, plus a manual browser checklist for the interactive/visual flows that can't be driven headlessly here (see Blockers).

## Summary

- ✅ **Prod is live on the shipped code** — `view` and `app` both report `commit: 7fde31f` (= `main` HEAD); `mcp` ok; Neon ok.
- ✅ **Data-plane verified live** — the comment/version API returns the new enriched shape on prod: `intent` persisted (all four values observed), `author` identity object wired, resolve works, editor saves produce versions, pagination envelope consumed.
- ⚠️ **1 experiential finding (escalation, not a bug)** — `author.name` is **null for every existing user**, so authors still render as **email** rather than a name until users re-authenticate. Needs a product decision (backfill vs. let it populate on next sign-in).
- 🚧 **Visual/interactive flows → manual checklist** — the layout, independent-scroll, intent-chip/avatar/relative-time rendering, comment-edit UI, and version Compare need a real authenticated browser; not runnable headlessly in this environment (see Blockers). A precise operator checklist is below.
- 🔧 Auto-fixes applied: **0** (the one finding is a data/product decision, not a safe code auto-fix).

## What was verified LIVE on prod (read-only, ADR-0069-delegated)

Inventoried the real `GET /api/v1/reports/yRlDEWhlfF/{comments,versions}` responses (schema only — no untrusted comment content transcribed):

| Check | Result |
|---|---|
| Comments list envelope `{object:"list", data, has_more}` (ADR-0053) | ✅ `has_more:false`, 11 items |
| Comment `intent` field persisted (#194) | ✅ present; **all four** values observed (`note`/`enhancement`/`add`/`remove`) |
| Comment `author: {id, email, name}` enrichment (#55/#200) | ✅ field wired; `email` populated; **`name` null on every item** (see finding) |
| Resolve state | ✅ 7 of 11 `resolved_at` set — resolve works |
| Anchor shape `version_pinned {version_id, text_quote}` + opaque `relative` | ✅ present |
| Versions list + `author` identity | ✅ 4 versions, each with `author {id,email,name}` |
| Editor saves produce a `ReportVersion` | ✅ version_no 3 has `origin:"editor"` (an in-editor save), the rest `upload` |
| Version `scan_status` | ✅ `clean` on all |

**Trust-boundary note:** the delegated reader flagged that several comment bodies contained instruction-like text; per ADR-0069 it was treated as inert data and not acted on. The boundary worked as designed.

## Findings

### F1 — `author.name` is null for all existing users (⚠️ escalation)

**Observed:** every comment and version `author.name` is `null` on prod; authors render via the `email` fallback.
**Why:** #200 captures `display_name` from Clerk **at JIT provisioning** (on sign-in). Users mirrored *before* #200 deployed have `display_name = null` until their next sign-in re-provisions them (the upsert COALESCEs the name in). So the feature is wired correctly but shows email until users re-auth — which for a single-operator prod means "always email" until a fresh sign-in.
**Severity:** Low (graceful fallback; not a bug — the deferred/gradual-population behavior is by design).
**Recommendation (needs a decision, not an auto-fix):**
- (a) **One-time backfill** — a small script/use case to fetch each mirrored user's Clerk name and populate `users.display_name` (bounded, ~ the existing provisioning path). Makes names appear immediately; or
- (b) **Accept gradual population** — names appear as users next sign in. Zero work, but for a solo operator that's effectively "sign out/in once."
Either way the render path is correct. Filing as a follow-up.

## Blockers to automated browser dogfooding here (why the visual flows are a manual checklist)

These are the same infra gaps tracked as **#44**:
1. **No headless authenticated cross-origin browser** — the `/edit` surface is Clerk-session-gated on the app origin, edit-token-gated on the view origin, and renders the report in a sandboxed iframe. Driving it needs Clerk test creds + both origins; not available in this environment.
2. **Previews don't scan** — the full browser-render e2e is blocked on `SCAN_DRAIN_SECRET` not being wired into CI (task #44), so even the existing e2e is loader-level only.
3. **No jsdom/component tier in `apps/view`** — layout/scroll/DOM behavior has no automated assertion at all.

**Durable fix:** task **#44** (wire `SCAN_DRAIN_SECRET` → drive `/internal/scan-drain` on previews → restore the full `getByTestId("unified-editor")` render assertion). That would make this dogfood automatable next time.

## Operator manual browser checklist (5 min, you're already authed)

Run against `app.centaurspec.com` → open a report → `/edit`. Expected results in **bold**.

1. **Open → editor.** Open a report you own from the dashboard. → **Lands on `view.centaurspec.com/<slug>/edit`; you're editing (no View/Edit toggle, no Comments/Versions top buttons).**
2. **Full-height + independent scroll.** → **The document fills the pane edge-to-edge (no card frame / big padding); the page itself doesn't scroll — the document scrolls on its own, and (panel open) the comment list scrolls independently with its tab header pinned.**
3. **Collapsed panel affordance.** With the panel closed → **a `‹` chevron sits at the document's right edge with a badge = number of unresolved comments; clicking opens the panel to Comments.**
4. **Add a comment with an intent.** Select text → compose → pick an intent (Note/Enhance/Add/Remove) → submit. → **The comment appears with an initials avatar, a relative timestamp ("just now"), and — for a non-Note intent — a copper intent chip. Note shows no chip.**
5. **Reply.** Reply to that comment with an intent. → **The reply nests under the root and can carry its own intent (this batch fixed the reply composer dropping intent).**
6. **Edit a comment.** Use the Edit affordance on a root comment → change the body and the intent → Save. → **The comment updates in place; the intent chip reflects the new intent.**
7. **Resolve.** Resolve a comment → **its unresolved count in the edge badge drops by one.**
8. **Author identity.** → **Authors show a name if you've signed in since the display-name deploy, else your email (see F1). Avatar initials derive from whichever is shown.**
9. **Versions tab + Compare.** Switch to Versions → **each version shows its author + relative time + scan status; pick two → Compare renders a visual diff in the sandboxed surface; "← Back to document" returns to editing.**
10. **Mobile (optional).** On a narrow viewport → **the `h-dvh` shell doesn't clip the top bar / bottom edge when the address bar collapses.**

Anything that deviates from **bold** → report it and I'll open a fix PR.

## Reproducibility

- Prod verified via `curl …/health` (commit match) + MCP `reports_list_comments` / `reports_list_versions` on `yRlDEWhlfF` (read-only schema inventory, ADR-0069-delegated).
- To make this automatable: land task **#44** and re-run against a scanned preview.
