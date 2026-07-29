# Dogfood Report: comment-UX adoptions (post-merge, prod)

**Scope**: PR #219 (feat/comment-ux-adoptions — the 7 "Adopt" items from the collaborate.md gap analysis)
**Target**: live prod (`view.centaurspec.com` `/edit` surface) at origin/main `c3411f5`
**Timestamp**: 2026-07-29 ~16:30 UTC
**Mode**: test-against-live; no-fix-on-main (all fixes go through a worktree branch + PR)
**Artifacts**: `.dogfood-state/2026-07-29-comment-ux.json` (operator-local — `.dogfood-state/` is gitignored); screenshots captured in-session
**Probe hygiene**: one probe comment created (add intent, "ergonomicsAdopt" anchor) and deleted by this run; the operator's own pre-existing Testing 1–5 comments were left untouched.

## Summary

✓ Passed: 6 / 7 executed scenarios (86%)
✗ Failed: 1 (E3 — click-highlight → panel focus has no visible effect)
⏭ Not executed: 1 (E7 print — covered at build/unit level only)
🔧 Auto-fixed: 0 (post-merge run; no-fix-on-main by policy)
⚠️ Escalations: 1 · Paper cuts / observations: 3

## Results

| ID | Persona | Journey | Result | Notes |
|----|---------|---------|--------|-------|
| E1 | editor (owner) | owner-open → `/edit` loads | ✓ | Always-editing surface, panel chip shows open-comment count |
| E2 | editor | select text → composer → intent `add` → save | ✓ | Intent select offers the 4-value vocabulary; saved comment paints an emerald-family highlight; amber (note) and the enhancement color render distinctly on other anchors |
| E3 | editor | click a painted highlight → panel focuses that comment | ✗ | **No visible reaction** — no focus ring, no panel scroll (two attempts, direct clicks on the mark). The PR's handler may be miswired on prod or the ring styling invisible; needs a fix branch |
| E4 | editor | panel "Jump" → editor scrolls to anchor | ✓ | Scrolled precisely to the off-screen anchor; see paper cut #2 |
| E5 | editor | panel ordering | ✓ | Document order confirmed — a newly created mid-document comment slotted between earlier/later anchors, not at top (wire is newest-first, so the client sort is doing its job) |
| E6 | editor | composer keys + isolation | ✓ | ⌘Enter saved; Esc cancelled and discarded; arrows/space acted inside the textarea with zero document scroll leak (the collaborate.md trap explicitly avoided) |
| E7 | editor | print: chrome hidden, highlights kept | ⏭ | Not executed live (no print-media emulation in the driver); verified in the emitted CSS + unit tests at build time. Residual: one manual ⌘P check |
| B1 | anon | public `/<slug>` + anon `/edit` | ✓ | 302 → unlock wall (private-by-default intact); anon `/edit` degrades to the public viewer. No regression from the comment-UX changes |

Also verified along the way: highlights **restore on reload**; resolved comments get no highlight and drop their Jump affordance; intent badges render in the panel (`Add`, `Remove`).

## Escalation (1)

**E3 — click-highlight → panel focus is inert on prod.** `packages/editor` ships `onCommentClick` wiring and `CommentsPanel` has focus-ring + scrollIntoView code (unit-tested), but clicking a painted mark in the live document produces no visible panel response. Hypotheses for the fix branch: the decoration click handler not firing inside the editor iframe on the built bundle, the focused-state prop not reaching the panel, or a focus ring styled invisibly against the dark panel. Per policy this is a `fix/` worktree + PR, not an on-main patch. *This was the "highest-frequency navigation win" of the gap analysis — worth fixing promptly; half of the bidirectional pair (Jump) works.*

## Observations / paper cuts (no action taken)

1. **Jump opens the new-comment composer as a side effect** — jumping to a comment's anchor selects the range in the editor, which trips the composer's `pendingSelection` gate: the panel then shows "Commenting on: <that comment's quote>". Confusing; Jump should reveal, not start authoring. Likely fix: suppress the composer when the selection originates from `jumpToComment`.
2. **Selection/quote capture bleeds across inline nodes** — double-click word selection extends into an adjacent inline element when there's no intervening whitespace in the doc model, so quotes read `ergonomicsAdopt` / `keeps highlightsA` (stored range confirmed 15 chars spanning both nodes). Anchor still resolves; the quote is just ugly and slightly wrong. Candidate fix: trim the anchor to the node boundary of the majority selection, or insert a separator when concatenating text across nodes.
3. **New comments show "Unknown user" until reload** — the create response lacks the Author Identity enrichment the list endpoint applies, so the just-posted comment renders a "?" avatar until refresh (self-heals). Candidate fix: enrich the create/reply responses the same way, or optimistically render the signed-in user.

## Blocked residuals

1. **E7 print** — needs a manual ⌘P visual check (or a driver with print-media emulation): panel/TopBar hidden, highlight pigments retained on paper.
2. **Degraded-anchor badge ("Pinned to vN")** — not exercised: producing a genuinely unresolvable anchor requires editing the document out from under a live comment, which would have mutated the operator's real report content mid-run. Covered by unit tests; a live check belongs to a future run against a disposable probe report.

## Reproducibility

Replay: owner-open `l_ZjxKJDQH` → `/edit` on prod at `c3411f5`; scenarios are self-contained (E2 creates and this run deleted its own probe comment). State: `.dogfood-state/2026-07-29-comment-ux.json` (operator-local).
