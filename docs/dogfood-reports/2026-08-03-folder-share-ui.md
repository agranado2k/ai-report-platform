# Dogfood Report: folder sharing UI (post-merge, prod)

**Scope**: PRs **#230** (ADR-0076 model + API + MCP) and **#234** (the dashboard sharing UI, ADR-0076 §6 amendment) — both merged
**Target**: live **production** (`app.centaurspec.com` dashboard sidebar) at `main` @ **121e2e9** (merge of #234)
**Timestamp**: 2026-08-03
**Personas**: `end_user` (dashboard owner, in a real browser) + `api_consumer` (MCP tools, used to verify folder state independently of the UI's own claims)
**Mode**: test-against-live; no-fix-on-main — every fix lands on `fix/dogfood-folder-ui` via PR
**Data hygiene**: **testing ran against PRODUCTION.** Every folder used was a throwaway created by this run and deleted at the end of it (`dogfood-20260803`, `dogfood-child`, `dogfood-parent`). Folder visibility and share state were verified **independently through the MCP API** (`folders_list`) rather than trusting the sidebar's own rendering. **No real folder was modified** — no visibility toggle, no share, no cascade, and no delete touched a pre-existing folder.
**Artifacts**: `.dogfood-state/` is operator-local and gitignored; screenshots captured in-session.

## Summary

✓ Passed: **10 / 10** executed scenarios (100% functional)
✗ Failed: 0 functional failures
⚠️ Issues found: **4** (2 MEDIUM, 2 LOW) — all experiential/copy/safety-of-repeat-click, none blocking the model
🔧 Fixed on this branch: **4 / 4**
⛔ Not coverable this run: **3** (see Limitations)
📝 Observations, not actioned: 1

The ADR-0076 model itself held everywhere it was exercised: nothing leaked, nothing was
mis-scoped, and every claim the panel made about who can see a folder matched what the MCP API
reported. All four findings are about the SURFACE — how a true statement was worded, sized, or
left on screen after it stopped being true.

## Results

| ID   | Persona      | Journey                                                | Result | Notes |
|------|--------------|--------------------------------------------------------|--------|-------|
| V1   | end_user     | Root folder row                                        | ✓ | No badge and no kebab — ADR-0076 §3 rendered as absence, not as a control that errors |
| V2   | end_user     | Create a folder under Root                             | ✓ | Private by default; MCP `folders_list` confirms `visibility=private`, `owner=` the creator |
| V3   | end_user     | Create a child inside an org-visible folder            | ✓ | Child inherits the parent's visibility at creation (§3) |
| V4   | end_user     | Share by email from the panel                          | ✓ | Grantee appears in the roster; badge flips to "Shared with 1" |
| V5   | end_user     | Org toggle                                             | ✓ | Button flips to "Make private", and the "Only you can see this folder" sentence is correctly REMOVED (the §7 repair holds) |
| V6   | end_user     | Cascade to private, one child                          | ✓ | Applied, and the banner names the folder honestly: "Set to private, and applied to 1 folder inside: dogfood-child." |
| V7   | end_user     | Cascade checkbox presence                              | ✓ | Renders only on folders that HAVE children |
| V8   | end_user     | Cascade checkbox label                                 | ✓ | Direction-aware, counted and singularised |
| V9   | end_user     | Out-of-org share warning                               | ✓ | Inert-share notice renders next to the field |
| V10  | end_user     | Folder link accessible names                           | ✓ | Intact (the *visible* name is clipped — see I-1) |
| I-1  | end_user     | Badge for a folder whose roster wasn't loaded          | ⚠️ MEDIUM | Honesty + layout regression — see below |
| I-2  | end_user     | Cascade checkbox state after an action                 | ⚠️ MEDIUM | Safety: comes back ticked, in the opposite direction |
| I-3  | end_user     | Org-direction cascade warning, n=1                     | ⚠️ LOW | Subject-verb disagreement |
| I-4  | end_user     | Share field after a successful share                   | ⚠️ LOW | Address left in the field |
| A1   | api_consumer | MCP `folders_list` cross-check after every UI action   | ✓ | The API's view of visibility/ownership matched the sidebar's claims throughout |

## Issues

### I-1 — "Not org-visible" is a double negative that also breaks the layout (MEDIUM · honesty + layout)

The sidebar badge for a folder whose share roster was not loaded read **"Not org-visible"**. Two
problems, both observed:

- **It contradicts itself across surfaces.** The same folder badges **"Private"** once you open
  its panel (`?manage=<id>` loads the roster) — so one folder showed two different labels
  depending on where you looked.
- **It doesn't fit.** Far wider than "Org"/"Private"; in the 14rem sidebar it truncated a folder
  named `dogfood-20260803` down to **"dog…"** — three characters. Real folders already truncate
  to "HouseNumb…" / "Architectu…" / "Agentic W…", and the row carried **no `title` and no
  `aria-label`**, so the clipped name could not be read at all without opening the folder.

The reasoning behind that label (from the #234 review, M-5) is **correct and is preserved**:
without the roster the loader cannot honestly claim "Private", because a `private` folder may
still have individual grantees. The fix changes the presentation, not the claim.

### I-2 — the cascade checkbox comes back ticked, in the opposite direction (MEDIUM · safety)

Observed exactly: ticked *"Also make the 1 folder inside this one private"* and clicked *"Make
private"*. The reloaded panel showed *"Share with the whole org"* with the checkbox
**pre-checked** and the amber mass-exposure warning already displayed. A user who clicks the
button again without re-reading has now **bulk-exposed the subtree**. There is no preview and
no undo for that direction (ADR-0076 §cascade), which is what makes this a safety issue rather
than a paper cut.

### I-3 — the org-direction warning doesn't agree in the singular (LOW · copy)

Verbatim: *"Applying to everything inside will also make 1 folder that **are** currently private
visible to everyone in your org; making this folder private again won't put **them** back."*
The sibling checkbox label singularises correctly, so the pluraliser already existed.

### I-4 — the submitted address stays in the share field (LOW · paper cut)

After a **successful** share the email input still contained `dogfood-probe@example.com`, with
the grantee already listed above it. Clicking Share again simply re-submits the same address.

## Auto-fixes Applied

All four on branch `fix/dogfood-folder-ui`, strict TDD (failing test first), one logical change
per commit.

**`fix(folders): agree with the count in both cascade warning sentences`** — I-3

- Before: `Applying to everything inside will also make 1 folder that are currently private visible to everyone in your org; making this folder private again won't put them back.`
- After: `Applying to everything inside will also make 1 folder that is currently private visible to everyone in your org; making this folder private again won't put it back.`
- The legacy-adoption sentence had the same defect in its tail and was fixed with it: `…other members will no longer be able to change their sharing` → `…change its sharing` for n=1.
- Tests: both sentences, at n=1 and n>1.

**`fix(folders): shorten the unknown-roster badge and name folders on hover`** — I-1

- Before: badge label `Not org-visible`, no `title`; folder link had no `title` and no `aria-label`.
- After: badge label **`Limited`**, `title="Not visible to your whole org. Open this folder's sharing menu to see who it's shared with individually."`; every other badge gained a title too (`Org`, `Private`, `Shared with N`); the folder link now carries `title={folder name}`.
- **Why `Limited`**: it makes exactly the claim the loader can support — the whole org cannot see this folder — and asserts nothing about who else can, which is the honesty constraint M-5 introduced. It is 7 characters, the same width as `Private`, so it stops eating the folder name. It is not a double negative, and it does not contradict the `Private` the panel shows once the roster loads (`Limited` is a superset state, not a competing claim). Rejected: `Private?` (hedged and unreadable), an icon-only lock (needs its own accessible-name machinery and is invisible to the markup-reading e2e assertions), `Restricted` (10 chars — same layout problem in miniature).
- **This is interim.** The real fix is the batched share-count port method already filed as issue **#236**: with it every row could badge accurately and the unknown state disappears.
- Tests: label + title per state; a guard that the unknown label is never wider than the labels it shares a column with and never contains "not "; e2e assertions on the badge title and on the link's `title`.

**`fix(folders): stop a cascade tick and a shared address outliving their action`** — I-2 + I-4

- Before: both sharing forms are uncontrolled and re-render in place, so the DOM nodes (and the operator's last input) survived the action that consumed them.
- After: both are keyed on `folderFormKey` — the folder's visibility plus its roster size, the two facts an action can actually move — so a **successful** action remounts them with a fresh, empty input, while a **refusal** keeps what was typed for the retry. `autoComplete="off"` on the checkbox and the email field covers the other half: a browser restoring state across a reload or back-navigation, which no React key can reach.
- The **"+ New folder"** field had the same behaviour (pre-existing, not from #230/#234) and was fixed the same way, keyed on the visible folder count.
- Tests: `folderFormKey` unit tests for each transition that must reset (visibility flip, share added, share revoked, unknown→known roster) and for stability when nothing moved; e2e assertions that both fields render `autocomplete="off"`.

**`docs(folders): record the 2026-08-03 dogfood run and its fixes`** — ADR-0076 third amendment, diary entry, this report.

### Test-tier note (honest limitation of the I-2/I-4 regression tests)

The residual behaviour behind I-2/I-4 is **client-side**: the server renders no tick and no value
either way, so neither the unit tier nor the request-level e2e tier can observe the reused DOM
node directly. This repo has no component test tier (`vitest.config.ts` collects
`apps/app/app/server/**` but not `app/components/**` or `app/routes/**`), and the folder-sharing
e2e suite is request-driven. So the fix was made **observable at the tiers that exist**: the
remount rule is a pure, unit-tested function in the loader (`folderFormKey`, following this
module's existing "the server sends conclusions" doctrine), and the browser-restoration half is
asserted in the rendered markup by e2e. A true click-level assertion would need a new `@browser`
scenario with its own authenticated session; that is a reasonable follow-up, not something this
branch could write blind and verify.

## Escalations / observations (recorded, not fixed)

**The success banner shifts sidebar layout when it appears.** The outcome banner is inserted
above the folder tree, so the whole tree jumps down by its height on every sharing action. It is
deliberate that the banner lives outside the kebab (the menu can close on the next render, and
the operator must still see what happened — ADR-0076 §6), so the fix is a reservation/overlay
decision about the sidebar's layout, not a one-line change. Recommendation: reserve the space or
float the banner; either way it wants a design call rather than an auto-fix.

## Limitations — what this run could NOT cover

1. **Legacy-folder ADOPTION warning.** A legacy row is `owner_id IS NULL`, which only the
   migration-0019 backfill produces. Every legacy folder in production is **real user data**, and
   manufacturing one would mean writing to the prod DB. Not exercised live; covered by unit tests
   on `folderManagement` / `folderShareWarning` and by `load-owned.test.ts`.
2. **The second-user transition** ("a colleague loses sight of the folder" when it goes private).
   This run had one browser session. Covered by the e2e scenario, which drives two run-scoped
   identities.
3. **The `MAX_CASCADE` (>50 descendants) pre-flight refusal.** Would require creating 51
   throwaway folders in production. Covered by unit tests on `folderShareWarning`,
   `cascadeLabel` and `applyFolderVisibility`.

No new GitHub issues were filed by this run; #236 (batched share counts) already covers the
structural fix behind I-1.

## Reproducibility

- **Branch under test**: `main` @ `121e2e9` (merge of PR #234), running on production.
- **Fix branch**: `fix/dogfood-folder-ui` — 4 commits.
- **Replay**: sign in to `app.centaurspec.com`, create a throwaway folder under Root, create a
  child inside it, then walk V1–V10 in order from the sidebar kebab; cross-check each step with
  MCP `folders_list`; delete both folders (deepest first — a non-empty folder is refused).
- **Verification on the fix branch**: `pnpm typecheck` (14/14), full `vitest run`
  (**193 files, 1958 tests**, +10 vs the 1948 on `121e2e9`), `pnpm lint` (biome, clean — 1
  pre-existing CSS-specificity warning in a docs asset), `node scripts/docs-conformance/index.mjs`
  (green), `pnpm build` (all three apps — the `arp-domain`/`node:crypto` client-bundle constraint
  holds), `bddgen` (feature/steps compile).
