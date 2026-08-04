# Dogfood Report: folder sharing UI — post-fix VERIFICATION run (prod)

**Scope**: verification that the four findings of `docs/dogfood-reports/2026-08-03-folder-share-ui.md` are fixed in production, plus a no-regression sweep of the behaviours that run adjacent to them
**Target**: live **production** (`app.centaurspec.com` dashboard sidebar) at `main` @ **d97822a** (merge of PR **#237**, deployed 2026-08-03 20:50 UTC)
**Timestamp**: 2026-08-04
**Personas**: `end_user` (dashboard owner, in a real browser) + `api_consumer` (MCP tools, used to verify folder state independently of the UI's own claims)
**Mode**: test-against-live; **no-fix** — this run was a verification pass and **no code was changed**; the only artefacts are this report and a diary entry
**Data hygiene**: **testing ran against PRODUCTION.** Every folder used was a throwaway created by this run and deleted at the end of it (`dogfood2-parent`, `dogfood2-child`). Folder visibility, ownership and share state were verified **independently through the MCP API** (`folders_list`) rather than trusting the sidebar's own rendering. **No real folder was modified** — see the near-miss recorded under Escalations, which came close to that statement not being true.
**Artifacts**: `.dogfood-state/` is operator-local and gitignored; screenshots and DOM attribute reads captured in-session.

## Summary

✓ Passed: **14 / 14** executed scenarios (100%)
✗ Failed: 0
🐛 **New defects found: 0**
✅ Prior findings closed: **4 / 4** (I-1a, I-1b, I-2, I-3, I-4 — all confirmed in production)
🔧 Fixed on this branch: 0 (nothing needed fixing)
⚠️ Escalation: **1** — a process near-miss during the run itself (no data changed), which is evidence for issue **#235**
⛔ Not coverable this run: **3** (unchanged from the prior run — see Limitations)

**This run found zero new defects and closes out all four findings from
2026-08-03.** Every fix from PR #237 is live and behaves as the fix described,
observed in production and cross-checked through the MCP API. The two follow-ups
the prior run pointed at remain open: **#235** (ownership transfer) and **#236**
(batched share counts, which would retire the interim `Limited` label). The one
thing worth escalating from this run is not a product defect at all — it is how
the run itself was driven, and it lands squarely on #235.

## Results

| ID   | Persona      | Journey                                                        | Result | Notes |
|------|--------------|-----------------------------------------------------------------|--------|-------|
| F1   | end_user     | I-1a: badge for a folder whose roster is not loaded              | ✓ **FIXED** | Reads **"Limited"** (was "Not org-visible"); the managed folder reads "Private" |
| F2   | end_user     | I-1a: every badge carries an explanatory `title`                 | ✓ **FIXED** | Org badge verbatim: "Everyone in your org can see this folder." |
| F3   | end_user     | I-1b: folder links carry their full name as a `title`            | ✓ **FIXED** | Verified on all 6 real folders + both test folders; previously **none** had one |
| F4   | end_user     | I-1b: name truncation visibly reduced                            | ✓ **FIXED** | "dogfood2…" — the prior run's equivalent row clipped to "dog…" |
| F5   | end_user     | I-2: cascade checkbox state after a cascade action               | ✓ **FIXED** | `cascadeStillTicked: false`, panel flipped to "Make private", `autocomplete="off"` present |
| F6   | end_user     | I-3: org-direction cascade warning at n=1                        | ✓ **FIXED** | "is" and "it" both correct — quoted in full below |
| F7   | end_user     | I-4: share field after a successful share                        | ✓ **FIXED** | `fieldValueAfter: ""`, grantee in the roster, `autocomplete="off"` present |
| R1   | end_user     | Private-by-default on create                                     | ✓ | Both test folders came back `visibility: private`, owner = me |
| R2   | end_user     | Cascade applies to the descendant, banner names it               | ✓ | "dogfood2-parent: Set to org, and applied to 1 folder inside: dogfood2-child." |
| R3   | end_user     | Share by email succeeds                                          | ✓ | "dogfood2-parent: Shared with dogfood2-probe@example.com." |
| R4   | end_user     | Cascade checkbox label is direction-aware, counted, singularised | ✓ | "Also share the 1 folder inside this one with the whole org" |
| R5   | end_user     | Private folder with no shares                                    | ✓ | "Not shared with anyone yet. Only you can see this folder." |
| R6   | end_user     | Out-of-org share → inert-share warning                           | ✓ | Still renders next to the field |
| R7   | end_user     | Root folder row                                                  | ✓ | Still no badge and no kebab (ADR-0076 §3) |
| R8   | end_user     | Broader-state-wins badge                                         | ✓ | Org-visible folder that ALSO has one individual share badges **"Org"** |
| A1   | api_consumer | MCP `folders_list` cross-check after every UI action             | ✓ | The API's view of visibility/ownership matched the sidebar's claims throughout |

## Verification detail — the four prior findings

### I-1a — the unknown-roster badge (was MEDIUM · honesty + layout) → **CONFIRMED FIXED**

The sidebar badge for a folder whose share roster is not loaded now reads
**"Limited"**. The folder whose panel *is* open (`?manage=<id>`, roster loaded,
roster empty) reads **"Private"**. That is the ADR-0076 §5 honesty constraint
rendered as two non-competing claims rather than as the same folder reading two
contradictory ways.

Every badge now carries an explanatory `title`. Observed verbatim on the org
badge:

> Everyone in your org can see this folder.

### I-1b — folder names were unrecoverable when clipped (was MEDIUM, same finding) → **CONFIRMED FIXED**

Every folder link now has a `title` attribute **equal to its full name**. Verified
across **all 6 real folders in the sidebar plus both test folders** — eight for
eight. Before #237 there was no `title` and no `aria-label` on the row at all, so
a clipped name could not be read without opening the folder.

Truncation is also visibly reduced now that the badge column stopped eating the
name: the test folder renders as **"dogfood2…"**, where the prior run's
equivalent row clipped to **"dog…"**.

### I-2 — the cascade tick outliving its action (was MEDIUM · safety — the important one) → **CONFIRMED FIXED**

This was the finding with a real blast radius, and it is the one most worth
stating precisely. After performing a cascade action, the checkbox comes back
**unticked** — measured directly off the DOM as `cascadeStillTicked: false` —
with the panel correctly flipped to the opposite direction (**"Make private"**),
and `autocomplete="off"` present on the input.

Previously the checkbox came back **ticked** under a panel that had flipped
direction, i.e. one unread click from bulk-exposing the whole subtree, in the
direction that has no undo. That state is gone.

### I-3 — counted copy that stopped agreeing (was LOW · copy) → **CONFIRMED FIXED**

The org-direction warning now reads verbatim, at n=1:

> Applying to everything inside will also make 1 folder that is currently private visible to everyone in your org; making this folder private again won't put it back.

Both "is" and "it" are correct. (Before: "…1 folder that **are** currently
private … won't put **them** back.")

### I-4 — the submitted address staying in the share field (was LOW · paper cut) → **CONFIRMED FIXED**

After a **successful** share the email field is **empty** — measured
`fieldValueAfter: ""` — the grantee appears in the roster above it, and
`autocomplete="off"` is present on the field.

## Adjacent behaviours re-verified — no regressions

The fixes in #237 touched the loader's badge computation and remounted both
sharing forms on a key, so the behaviours around them were re-walked rather than
assumed:

- **Private-by-default on create (ADR-0076 §3).** Both test folders came back
  `visibility: private` with owner = me, confirmed through MCP `folders_list`.
- **Cascade still applies to the descendant, and the banner still names it
  honestly.** Verbatim: *"dogfood2-parent: Set to org, and applied to 1 folder
  inside: dogfood2-child."*
- **Share still succeeds**, banner verbatim: *"dogfood2-parent: Shared with
  dogfood2-probe@example.com."*
- **The cascade checkbox label is still direction-aware, counted and
  singularised**: *"Also share the 1 folder inside this one with the whole org"*.
- **A private folder with no shares still says**: *"Not shared with anyone yet.
  Only you can see this folder."* — the §7 gating (privacy copy only for
  `private`) holds.
- **The out-of-org inert-share warning still renders** next to the field.
- **Root still renders no badge and no kebab** (§3 as absence, not as an erroring
  control).
- **A folder that is org-visible AND has one individual share badges "Org"** —
  the broader state wins, which is the correct precedence: the individual grant
  adds nobody who couldn't already see it.

## Escalations

### E-1 — a coordinate click landed one control away from an irreversible adoption (process · no data changed)

This is a defect in **how this run was driven**, not in the product, and it is
recorded plainly because the margin was thin.

**What happened.** A coordinate-based click intended for the test parent folder's
submit button instead landed on a **neighbouring sidebar row's kebab** and opened
the sharing panel for **"Agentic Workflow Patterns"** — a **real** folder, one
carrying the permanent-adoption warning.

**What did not happen.** No mutation. Opening a `<details>` panel is read-only,
and an immediate MCP `folders_list` confirmed the folder was untouched:
`visibility: org`, `owner: null` — still a legacy, unowned row, exactly as it was
before the click.

**Why it still matters.** The click landed **one control away** from adoption.
Adoption is permanent, has no transfer path, and would have silently made me the
owner of another member's folder — a state no UI in the product can undo.

**Mitigation adopted mid-run.** All subsequent interaction switched from
coordinate-based clicking to **DOM/element-targeted interaction scoped to the
specific folder's panel**, so a control can only be actuated inside the folder
the scenario is addressing. The rest of this run was executed that way.

**Product conclusion — this is evidence for issue #235.** The near-miss is not
"the agent was clumsy"; it is that a permanent, un-undoable ownership change sits
one stray click from a read-only browse of the sidebar, and there is nothing
downstream of that click to catch it. Two things follow:

1. **#235 (ownership transfer) is the structural fix and this run argues for
   prioritising it.** Adoption being irreversible is what turns a misclick into a
   permanent state; a transfer path turns it into an inconvenience.
2. **Adoption specifically warrants a confirm step**, as opposed to the current
   warning-text-only model. ADR-0076's amendment justified warning-text-only
   partly on the surface's zero-JS constraint (the sidebar is built on the no-JS
   `<details>` idiom, CSP/Trusted-Types-safe). That constraint is real, but it
   argues about the *mechanism*, not about whether the confirmation is warranted —
   a server-rendered two-step (a confirm form that POSTs the adoption) satisfies
   both. Recommend deciding this alongside #235 rather than separately.

No fix was applied for E-1 on this branch: the product change it argues for is a
design decision, and the driving change was a change to the test method, already
adopted.

## Limitations — what this run could NOT cover

Unchanged from the 2026-08-03 run; all three remain unverified **in production**:

1. **Legacy-folder ADOPTION.** Still unverified in production, because every
   legacy folder there (`owner_id IS NULL`, produced only by the migration-0019
   backfill) is **real user data**. E-1 above is the sharpest illustration of why
   this run would not exercise it. Covered by unit tests on `folderManagement` /
   `folderShareWarning` and by `load-owned.test.ts`.
2. **The second-user transition** ("a colleague loses sight of the folder" when it
   goes private). Still unverified — this run, like the last, had a single browser
   session. Covered by the e2e scenario, which drives two run-scoped identities.
3. **The `MAX_CASCADE` (>50 descendants) pre-flight refusal.** Still unverified —
   it would require creating 51 throwaway folders in production. Covered by unit
   tests on `folderShareWarning`, `cascadeLabel` and `applyFolderVisibility`.

**Outstanding follow-ups** (neither filed by this run — both already open):

- **#235** — `transferFolderOwnership`. Adoption is permanent with no transfer
  path. E-1 is direct evidence for it.
- **#236** — batched share-count port method. Would let every sidebar row badge
  accurately and **retire the interim `Limited` label** introduced by #237.

No new GitHub issues were filed by this run.

## Reproducibility

- **Under test**: `main` @ **d97822a** (merge of PR #237), running on
  **production** (`app.centaurspec.com`), deployed 2026-08-03 20:50 UTC.
- **Date of run**: 2026-08-04.
- **Prior run being verified**: `docs/dogfood-reports/2026-08-03-folder-share-ui.md`
  (`main` @ `121e2e9`), findings I-1 → I-4.
- **Replay**: sign in to `app.centaurspec.com`; create a throwaway parent under
  Root and a child inside it; read the sidebar badge labels and their `title`
  attributes, and every folder link's `title`, straight off the DOM; open the
  parent's kebab, tick the cascade checkbox, submit, then re-read the checkbox's
  `checked` and the panel's direction; share to an out-of-org address and re-read
  the email input's `value`; cross-check each step with MCP `folders_list`; delete
  both folders (deepest first — a non-empty folder is refused).
  **Drive every interaction by element target scoped to the folder's own panel,
  never by screen coordinates** — see E-1.
- **This branch**: `docs/dogfood-verify-237` — documentation only; no product code
  changed, so no test-suite delta to report. `pnpm docs:check` green.
