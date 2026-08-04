# ADR-0078: Folder-scoped report sharing — an explicit bulk apply, an inherited default, and a read/write choice

- **Status**: Accepted
- **Date**: 2026-08-04
- **Deciders**: agranado2k
- **Relates to / amends**: **ADR-0060 (extends its WRITE seam** — `canWrite` gains a third leg; the "folder-level can layer on the same seam later" trade-off is what this cashes in), ADR-0076 (**does NOT reverse** its visibility-only separation — see Decision 2), ADR-0075 (the listing predicate gains an org-write leg), ADR-0059 (`set_acl`/`delete` stay owner-only — unchanged), ADR-0056 (the `Acl` stays read-only and keeps its five modes), ADR-0063 (an org-write actor gets `scope:"edit"`, **never** `owner:true`), ADR-0038 (the viewer is untouched), ADR-0039 (no derived-key fallback for the new state-setting ops), ADR-0046 (the new port gets a two-runner contract suite), ADR-0070 (three new audit actions), ADR-0016 (`acl:write` gates the new mutations).

## Context and problem statement

A member of the House Numbers team org shared a folder ("House Numbers") with
the whole org. A colleague can now see the folder in their sidebar — and none
of the reports inside it. That is not a bug in ADR-0076; it is ADR-0076 working
exactly as written: a folder share confers **visibility of the folder's name and
position**, and the reports inside stay governed by their own `Acl`s. ADR-0075's
listing predicate (owner OR `acl.mode IN (org, public)` OR write grant) never
consults the folder, and it shouldn't have to — a report's `Acl` is the one
place its reach is decided.

But the operator's intent when sharing a folder is very often "and the things in
it". Three demands arrived together:

1. Folder sharing must be able to **reach the reports inside**.
2. Sharing must offer a **read-vs-write choice** — "they can look" and "they can
   edit" are different acts and today only the first is expressible at org
   scope.
3. Reports need a **report-level sharing control** in the dashboard, mirroring
   the folder one that shipped with ADR-0076's amendment.

Today's vocabulary cannot express (2) at all. Write is `isOwner OR
hasWriteGrant` (ADR-0060) and a write grant is **email-keyed, one person at a
time**. There is no org-wide write anywhere in the model.

## Decision drivers

- **The `Acl` is the report's reach, and it must stay the only such place.** Any
  mechanism that made a report reachable *without* changing its `Acl` would put
  a second, invisible source of truth behind the viewer and the listing — two
  surfaces that have each already been repaired once for exactly that class of
  bug (ADR-0075, ADR-0076 §5).
- **No new authorization path.** The viewer's one-uniform-gate (ADR-0038) and
  the app-authorizes/viewer-verifies keystone (ADR-0056) are load-bearing. A
  folder-derived access-token claim, or a folder leg in the viewer's gate, would
  be a second door into content.
- **Read and write must never be separable at this control.** ADR-0060 §6 is
  explicit that "a write grant confers no view access by itself" — the deliberate
  separation of the read capability (`Acl`) from the write capability (grant).
  A control that could produce write-without-read at ORG scale would make that
  composition the default, not the exception.
- **Authorization is re-run per report, by the same guard.** ADR-0076's cascade
  amendment says it plainly: re-implementing an ownership gate in recursive SQL
  is "the classic place an authorization bypass gets introduced".
- **Nothing already configured gets silently destroyed.** `password`,
  `allowlist` and `public` represent deliberate owner intent that a coarse
  three-state control could trample.
- **Root is the default upload placement and is permanently org-visible**
  (ADR-0076 §3). Any create-time inheritance rule must carve it out or every
  upload in the product becomes org-visible.

## Considered options

- **Explicit bulk apply + inherit-on-upload** *(chosen)* — a folder-scoped
  action that changes each report's real `Acl`, plus a create-time default drawn
  from the destination folder.
- **A folder leg in the listing predicate** (a report is listed if its folder is
  org-visible) — rejected: it makes a report *listed* without making it
  *openable*, which is precisely the ADR-0075 "rows that bounce" defect, and it
  puts the report's reach in two places.
- **A folder claim in the access token / a folder leg in the viewer's gate** —
  rejected: a second door into content, against ADR-0038's one-uniform-gate and
  ADR-0056's keystone. It would also make the folder tree part of the viewer's
  hot path.
- **Recursive SQL cascade from the folder** — rejected for the ADR-0076 reason
  above: the per-report owner-only gate would have to be re-expressed in SQL.
- **Put write into the `Acl`** (e.g. an `org_edit` mode) — rejected: the `Acl` is
  a READ authorization value object consumed by the viewer, and giving it a
  write meaning would push write semantics into the one place ADR-0056 built to
  be read-only. It would also collide with `password`/`allowlist`, which are
  read gates that say nothing about write.
- **Reverse ADR-0076 and make folder shares confer report access** — rejected:
  the separation is deliberate and the reports inside a shared folder frequently
  belong to *other* people, who never consented.

## Decision outcome

### 1. A new domain concept: the **Org write grant**

Write today is `isOwner OR hasWriteGrant` (ADR-0060 §4) and there is no
org-wide write. This ADR adds one, on the **same seam** ADR-0060 left open
("folder-level can layer on the same seam later"), and deliberately NOT inside
the `Acl`.

New table `report_org_write_grants`, mirroring the `report_write_grants` family:

- `report_id uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE`
- `org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT`
- `granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `granted_at timestamptz NOT NULL DEFAULT now()`

**One row per report** — the PK is `report_id` alone, because a report belongs
to exactly one org. `org_id` is stored (not merely joined from `reports`) so
the check is a single indexed lookup and so the grant records *which* org it was
issued for; a report cannot change orgs today, and if it ever could, a stale row
would fail the match rather than silently widen.

`canWrite` gains a third leg:

```
canWrite(report, actor) =
     report.ownerId === actor.userId          // owner (ADR-0059)
  OR hasWriteGrant(report, actor)             // personal, email-keyed (ADR-0060)
  OR hasOrgWriteGrant(report, actor)          // NEW: org-wide
```

`hasOrgWriteGrant` **MUST verify the org match**: a row exists for the report
AND `actor.orgId === report.orgId` AND `row.org_id === report.orgId`. This is
the one deliberate asymmetry with ADR-0060: personal write grants work
**cross-org by design** (§4 — the typical grantee lands in a JIT personal org),
whereas an org write grant is meaningless outside the org it names and granting
it cross-org would be a straight privilege escalation. The org check is not an
optimization; it is the whole safety property of this leg.

Everything ADR-0060 §3 says about the *level* of a write grant carries over
unchanged: **rename, re-upload, move — NOT delete, NOT `set_acl`, NOT grant
management.** Delete and `set_acl` stay owner-only, permanently (ADR-0059 §2).

### 2. This does NOT reverse ADR-0076

**Folder shares still confer visibility of the folder only.** Nothing in this
ADR makes a `folder_shares` row or a folder's `visibility` a term in any report
authorization decision. What changes is that the owner is given an **explicit
action** that walks the folder and changes each report's own `Acl`, plus a
**create-time default** — precisely mirroring the way a new child folder already
takes `inheritedVisibility` from its parent (ADR-0076 §3) without the parent's
visibility ever being consulted again afterwards.

The consequence is the one that makes this design safe: because real `Acl`s (and
real org-write rows) change, **both the listing surface and the viewer-serving
surface work through their existing paths**. No new listing predicate leg for
folders. No new access-token claim. No viewer change. A report shared this way
is indistinguishable, at every downstream gate, from one the owner shared by
hand.

### 3. Three states, read and write always paired

The **report sharing state** is exactly one of three values, and the control
never expresses anything else:

| State | `Acl` mode | Org write grant | Reads as |
| --- | --- | --- | --- |
| `private` | `private` | absent | Only you |
| `org_view` | `org` | absent | Everyone in your org can view |
| `org_edit` | `org` | present | Everyone in your org can view and edit |

**Write is never offered without read.** `org_edit` always carries `acl.mode =
'org'`; there is no transition in this control that produces an org-write row on
a report the org cannot read. That is ADR-0060 §6's separation honored at the
scale where violating it would matter most: an org-wide write-without-read would
hand every member the ability to publish content into a report none of them can
open.

**Delete stays owner-only in all three states**, matching personal write grants
exactly (ADR-0060 §3). So does `set_acl` — which means **every transition
between these three states is owner-only**, since each one is a `set_acl` plus
an org-write row write.

### 4. The advanced modes are protected, not clobbered

`password`, `allowlist` and `public` are **displayed** by the new control (a
report in one of them badges as `Password` / `Allowlist` / `Public`) but are
never silently overwritten. Moving a report OUT of one of them requires an
**explicit confirmation step**: server-rendered, zero-JS, a **second submit** —
not a `window.confirm`, which the CSP posture and the zero-JS idiom both rule
out. The confirmation copy names what is being discarded ("this will remove the
password", "this will remove the N allowlisted addresses").

Setting a password or an allowlist stays exactly where it is today (`set_acl`
via API/MCP). This control does not gain those inputs — it is a three-state
control that happens to be honest about the two states it cannot produce.

### 5. Folder bulk apply — a caller-side loop, bounded, direction-aware

When a folder is set to `org` (or is already `org` and its owner re-applies),
the folder panel offers **"also share the N reports inside"** with the
view-only / view-and-edit choice.

**Implementation is a CALLER-SIDE LOOP** calling the existing per-report use
case once per report — **not recursive SQL**. Every iteration therefore re-runs
that report's own owner-only authorization gate. This is ADR-0076's cascade
rationale applied verbatim, and the reason is the same: a recursive `UPDATE`
would have to re-implement the gate, which is "the classic place an
authorization bypass gets introduced". It is bounded exactly like the folder
cascade — a `MAX_CASCADE`-style **pre-flight refusal** (enumerate before
touching anything, so a refusal changes nothing at all) with an honest message,
never a silent truncation.

**The candidate rule, chosen for least surprise.** A report inside the folder is
a candidate **only if** the actor **owns** it **AND** its **composed sharing
state** (Decision 3) is not already the one being applied. Everything else is
**SKIPPED and NAMED with a reason**:

- *not owned by you* — the actor cannot `set_acl` it, and the loop asks rather
  than decides (ADR-0076's cascade principle);
- *password-protected* / *allowlisted* / *already public* — deliberate owner
  intent this control must not trample (Decision 4), refused towards **every**
  target, not just the org ones;
- *already private* / *already shared with your org to view* / *already shared
  with your org to view and edit* — already there.

**The rule reads the COMPOSED STATE, not the `Acl` mode.** `org_view` and
`org_edit` share an `Acl` mode and differ only in the org-write row, so a rule
that read the mode alone could not tell them apart: every transition between
them silently no-opped while the summary reported success, and the `org_edit →
org_view` case — an access **reduction** — left the whole org holding edit while
returning `changed: []`, `failed: []` and 200. The listing projection already
carries `ownerId`, `aclMode` **and** `hasOrgWrite` (Decision 8), so all three
facts the rule needs cost no extra round trips. **All six transitions between
the three states are pinned**, in both directions, on what actually landed in
the stores rather than on the summary.

A report in **no expressible state** (org write without org read — the
combination only the API can produce) is a **candidate**: it can never equal a
target, and applying one *repairs* the pair rather than trampling anything.

The result uses the folder cascade's honest partial-reporting shape (`changed[]`
plus `failed[]`/`skipped[]`) and **never claims success for something it did not
touch**.

**All three targets are offered**, not two directions: the panel renders three
separate submits (`org_view`, `org_edit`, `private`), so `private` takes the
folder's org-shared reports back and revokes their org-write rows, and the two
org targets move reports between view and edit in either direction.

**v1 covers the ORG direction only.** Person-level folder shares stay
visibility-only, exactly as today, and the UI **says so**. The report-level
analogue of a person share is `allowlist` — a TTL-bounded, magic-link-redeemed,
viewer-side read grant addressed by email — which does not map cleanly onto a
folder share (different lifetime, different redemption, different actor
identity). Tracked as **issue #242**.

### 6. Inherit on upload

A report uploaded into a **non-Root** folder takes that folder's visibility as
its initial `Acl`: `org` → `org`, `private` → `private`. Uploads into **Root**
stay `private` — today's behavior, unchanged.

**The Root carve-out is the whole reason this is safe.** Root is permanently
`org`-visible (ADR-0076 §3) *and* is the default upload placement (ADR-0037).
Inheriting visibility without exempting it would make **every upload in the
product org-visible** — a silent, product-wide privacy regression shipped as a
convenience feature. The carve-out precisely mirrors `inheritedVisibility`,
which already special-cases the Root for the identical reason: "the Root's own
`org` visibility is a usability invariant, not a sharing intent."

**Org-write is NOT inherited on upload.** Write is always an explicit act. A
report created inside an `org_edit` folder arrives at `org_view`.

### 7. Move stays ACL-neutral

Moving a report does **not** change its sharing, in either direction.

This is a deliberate decision, not an omission. `moveReport` is gated on
`canWrite` (ADR-0059 §2 / ADR-0060 §4), not on ownership — so a **write
grantee**, who may be **cross-org** and who by ADR-0060 §6 has **no view access
at all**, can move a report. If a move applied the destination folder's sharing,
that grantee could publish a report they cannot read into an org-visible folder:
exactly the write→read composition ADR-0060 §6 forbids. Inheritance is therefore
a **create-time** rule only, where the actor is the owner by construction.

### 8. The listing predicate gains an org-write leg

`ReportRepository.searchByOrg` lists a report when the viewer owns it, OR
`COALESCE(acls.mode,'private') IN ('org','public')`, OR a write grant matches,
**OR an org-write row exists for it and the viewer's org matches**.

In the states this ADR defines the new leg is redundant — `org_edit` always
implies `acl.mode='org'`, which the second leg already catches. It exists
because the API can produce an org-write row on a non-`org` report (the grant
and the `Acl` are separate resources), and a listing that hid a report the
viewer can *edit* would be dishonest in the same way ADR-0075 exists to prevent.
Mirrored in the in-memory fake and in the contract matrix on **both runners**
(ADR-0046). `hasReportsInFolder` stays un-scoped, as ADR-0075 §5 requires.

### 9. The viewer is untouched, and the token stays `scope:"edit"`

No changes to `apps/view`. An org-write user reaching `/reports/{slug}/open`
passes `loadWritableReport` → `canWrite` and is minted a `scope:"edit"` token —
and **never** an `owner:true` one. ADR-0063 is explicit: "minting an
`owner:true` token for a non-owner would be a privilege escalation". A test pins
this.

Their *read* on `GET /{slug}` comes from `acl.mode = 'org'`, through the
viewer's existing gate.

> **Correction (2026-08-04).** An earlier revision of this section claimed that
> "without the paired `Acl`, an org-write user would hold an edit token for
> content the viewer would refuse to serve them", and used that as a safety
> argument for Decision 3. **That is false, and it must not be relied on.**
>
> `decideEdit` in `apps/view/app/server/gate.server.ts` **never consults
> `report.acl`** — deliberately, and since ADR-0063 Decisions 3-4: the edit
> capability is checked *instead of* the share-mode ACL, because a valid edit
> token proves the app already ran `canWrite` at mint time. Its one remaining
> gate is `resolveViewableReport`, which maps not-found / deleted / flagged /
> scanning and otherwise serves the live version. So **an edit token IS a read
> capability** on `/{slug}/edit`, whatever the `Acl` says.
>
> The pairing in Decision 3 therefore stands on its own merit — ADR-0060 §6's
> read/write separation, and not handing an org write capability to people who
> cannot open the report — and **not** on any viewer-side refusal. It is also
> what makes Decision 11 a *read* fix and not only a write one: an org-write row
> that outlived its `Acl` left every org member holding a mintable edit token,
> and therefore the content, on a report the `Acl` had made private.

**The org an edit token acts in is a CLAIM, not the report's.** The acceptance
seam (`edit-token-actor.server.ts`) used to source the actor's org from the
report it was resolving, which made `hasOrgWriteGrant`'s `actor.orgId ===
report.orgId` guard a tautology on that door: every valid token was, by
construction, in the report's org — including a **cross-org personal grantee's**
(ADR-0060 §4 supports those by design), who would keep passing through the ORG
leg after their own personal grant was revoked. `mintEditToken` now stamps the
Clerk-**verified** session org as an optional `org` claim, carried forward across
refreshes exactly like `sessionStart`, and the seam compares that.

**What this does and does not buy, stated plainly.** It makes the org check
*meaningful*; it does not make it *live*. This system mirrors no org-membership
row — membership is asserted by the Clerk session — so a user who **leaves** the
org keeps whatever org their token already claims until it dies. The bound on
that is `SESSION_CAP_SECONDS` (ADR-0063's amendment), which exists precisely for
revocations the server cannot observe. Ownership, the personal grant row and the
org-write row itself all remain re-checked **live** on every accept. A token
minted before the claim existed falls back to the report's org — today's
behavior, for the ≤ `EDIT_TTL_SECONDS` window after a deploy; failing closed
there would 401 every in-flight editor.

### 10. Parity, idempotency, audit

- **Wire:** `POST /api/v1/reports/{slug}/sharing` (set the three-state sharing)
  and `POST /api/v1/folders/{id}/reports/sharing` (the bulk apply). MCP
  `reports_set_sharing` and `folders_apply_sharing_to_reports` — MCP is the
  primary write surface, so parity is not optional. Both gate on **`acl:write`**
  (ADR-0016), like the rest of the sharing family; sharing is sharing, no new
  scope.
- **Idempotency (ADR-0039):** these are **state-setting** operations, so they
  MUST NOT use the derived-key fallback — the precedent and its rationale are in
  `set-folder-visibility.ts`: a derived key is a permanent record, so
  `private → org → private` would replay the first response and never re-save,
  leaving the report `org` while the API answered `private`. The two endpoints
  land in **different** places, and an earlier revision of this section wrongly
  described them as the same:
  - `POST /reports/{slug}/sharing` — idempotency engages **only on an explicit
    `Idempotency-Key`**, exactly as written above. With a client-supplied key
    the client owns retry identity and the usual claim/replay machinery applies.
  - `POST /folders/{id}/reports/sharing` — takes **no key at all**, explicit or
    otherwise. It is a LOOP of individually idempotent-in-effect state sets, and
    the thing a replay would return is a *summary* — `changed` / `skipped` /
    `failed` for N reports — whose per-report outcomes may no longer be true by
    the time it is replayed. Handing back a stale account of what happened is
    worse than re-running an operation that is already idempotent in effect,
    because the whole contract of this response is that it describes reality.
    Re-running is also safe by construction: every iteration re-enters
    `setReportSharing`, which re-runs its own gate and skips anything already at
    the target state.

  **ADR-0039 has now accumulated three carve-outs** — `setAcl`'s password mode
  (a derived key must never be a function of the plaintext), `setFolderVisibility`
  (state-setting, so a permanent derived key would strand the state), and this
  one (state-setting plus a summary that must not be replayed). They are recorded
  only in the three use-case module docs; there is no consolidated record, and
  the rule "state-setting operations take an explicit key or none" is now the
  common shape rather than the exception. Consolidating it belongs in an
  amendment to ADR-0039 itself, and is deliberately **not** done here.
- **Audit (ADR-0070):** `grant.org_write.granted`, `grant.org_write.revoked`,
  and `report.sharing_set` — the last recording `from`/`to` sharing states, so
  the log carries the transition and not just the endpoint that was hit. The
  bulk apply produces one row **per report it actually changes**, for the same
  reason ADR-0076's cascade does: one collapsed row would be a less truthful
  record.

### 11. Every door onto the `Acl` prunes the org-write grant

`setReportSharing` is not the only way to change a report's `Acl`. `POST
/api/v1/reports/{slug}/acl` and MCP `reports_set_acl` (Decision 4 — the only way
into `password` and `allowlist`) write the *same* `Acl`, and an owner can reach
`org_edit` through the first door and then narrow through the second.

**`setAcl` therefore revokes the org-write row whenever the new mode is not
`org`**, inside the same `UnitOfWork` as the `Acl` write, mirroring the
`pruneStaleGrants` precedent verbatim: *a durable grant must not outlive the
`Acl` that authorized it* (ADR-0056 "5e"). `private`, `password`, `allowlist`
and `public` all narrow READ below org, so the org-wide WRITE goes with them.

**Mode `org` is deliberately left alone.** Re-asserting `org` neither grants nor
revokes write: the pair `org_edit` is defined by (Decision 3) is still intact,
and this is a call the owner made about *reading*. Revoking would silently
downgrade `org_edit` to `org_view` on a call that never mentioned write, and the
response body — which carries only the `Acl` — could not even report it.
Granting would be worse: `setAcl` would manufacture org-wide write out of a read
call.

Without this, narrowing through the second door left the row behind, and the
consequences were not confined to write: every org member still passed
`canWrite` (rename / move / re-upload), the report stayed **listed** to them
through the Decision 8 org-write leg, and — per the correction in Decision 9 —
the edit-token door served them its **content**. Pinned on both contract runners
(ADR-0046), for all four narrowing modes, in
`set-acl-grant-pruning.contract.ts`. The revocation emits its own
`grant.org_write.revoked` audit row (Decision 10), and only when a row actually
moved.

### 12. The dashboard sharing surface

The operator's **third** explicit demand was a report-level sharing control, and
until this section it was recorded only in Context. The choices below are
architectural, not cosmetic, and are enforced by
`apps/app/app/server/report-sharing.server.ts` and its tests.

**The server sends CONCLUSIONS, not inputs.** `ownerId` never reaches the
client. The loader computes `manageable` / `blockedReason` / the badge / the
discard warning with the SAME predicates the use case enforces, in the same
order (scope gate first, then ownership), and ships plain data. A control this
module enables is a control the server will accept. The alternative — shipping
the ownership fact and letting the client decide — is an independently invented
client rule that drifts from the server that actually decides. This is the
`folderManagement` doctrine from ADR-0076's amendment, applied verbatim.

Two consequences of that doctrine, both load-bearing:

- **A disabled control renders the SERVER's own reason.** `NON_OWNER_REASON` is
  derived from the application layer's `SETTING_SHARING_NOT_OWNER` constant, so
  the sentence a member reads is the sentence the 403 would have given them.
- **Components must never import `arp-domain`** — its barrel pulls
  `node:crypto` into the client bundle. Every domain-derived decision is
  therefore computed server-side, which is *why* this module exists at all.

**The badge taxonomy is honest about what it cannot express.** Six labels, not
three: `Private`, `Org`, `Org + edit`, and the advanced modes `Password` /
`Allowlist` / `Public` under their own names. Folding the advanced modes into a
generic "shared" would be the first step towards overwriting one with another
(Decision 4). The sixth is the `Edit only` **danger** badge, for the API-only
combination of an org write grant without org read: saying `Private` there would
be exactly the lie `reportSharingState` returns `null` to prevent — a report the
whole org can edit, badged as nobody's but yours. The full claim lives in the
badge's `title`, because the label shares a truncating row.

**The confirmation is a second submit, keyed on the state it was staged for.**
No `window.confirm` (Decision 4). The form's React `key` is
`reportFormKey(aclMode, hasOrgWrite)` — both facts, so `org_view → org_edit`,
which keeps `acl.mode = 'org'`, still remounts. This is the **#237 hazard**
transplanted: an uncontrolled form inside a panel that re-renders in place keeps
its DOM nodes, so a confirmation ticked for "discard the password" would still
be ticked under a panel that had already moved on. A success remounts the form
empty; a refusal keeps what was chosen, which is what a retry needs.
`autoComplete="off"` covers browser restoration, which no key reaches.

**The folder bulk apply is THREE buttons, not a select plus a submit.** Each
button says what it does and carries its own target state, so nothing can sit
staged in a form that outlives the state it was staged for — the same #237
lesson, at folder scale. It also means the panel offers all three targets
symmetrically, which is what Decision 5's composed-state rule needs.

**The discard warning is withheld from a row the actor cannot change.** It is
the confirmation's sentence, and a row with no confirmation has no use for it;
computing it before the ownership gate put "shared with N addresses by
invitation" into a non-owner's loader payload. No emails, but a fact about
someone else's report that this surface had no reason to state.

**The warning names the REAL roster size.** `ReportSummary` carries
`allowedEmailCount` off the same free join as `aclMode` (Decision 8) — the count
only, never the addresses. Without it the control defaulted to `1` and every
allowlisted report warned about "1 address" while the server's own 422 named the
true N: the operator saw a right number and a wrong one, which is worse than no
number at all.

**The panel is offered on PRIVATE folders too, and that is deliberate.** ADR-0076
is emphatic that a folder's visibility is not its contents' reach, and this panel
is a REPORT-sharing control that merely happens to be scoped by a folder. Gating
it on the folder's own visibility would (a) reintroduce exactly the folder→report
coupling Decision 2 exists to avoid, and (b) hide the `private` direction from
the owner who needs it most — someone with org-shared reports sitting inside a
private folder, who wants them back. The panel says what it changes, and what it
leaves alone, in its own words.

**The UI is deliberately NARROWER than the API, and the gap is recorded.** The
dashboard renders the bulk apply only inside the folder-sharing panel, which is
gated on folder *manageability* (owner-or-legacy, ADR-0076 §6). But the use case
guards on `loadVisibleFolder`, deliberately — Decision 5 argues that requiring
folder ownership "protects nothing, since the loop can only ever touch reports
the actor already owns". So the very case that argument is built on — a member
bulk-sharing their OWN reports inside a colleague's folder — is reachable only
via the API and MCP, never the dashboard. That asymmetry is accepted, not
overlooked: the permissive rule belongs in the use case (it is the correct
authorization), and the narrower UI is a surface decision about where the
control sensibly lives. If the case ever shows up in practice, the fix is a UI
change, not an authorization change.

### 13. The read surfaces answer with the composed sharing state

Every WRITE surface returned the composed answer; the READS returned the `Acl`
alone — `GET /api/v1/reports/{slug}`, `GET …/acl`, MCP `reports_get` and
`reports_get_acl`. That is not enough information to answer "how is this
shared?": `org_view` and `org_edit` are **identical** in the `Acl` and differ
only in a row the caller cannot see, so a client reading `acl.mode === "org"`
infers one of them and has a 50% chance of being wrong.

MCP is the primary write surface (Decision 10), so an agent that reads before it
writes is precisely the caller most likely to be misled — and the mistake it
makes is "already shared, nothing to do" on a report the whole org can edit.

So both reads now carry `sharing`, via one `withReportSharing` wrapper applied
*after* each read's own gate has passed — it adds a single indexed lookup and no
authorization of its own. It is `null` for a state the vocabulary cannot express,
never rounded down to `private`. A store failure PROPAGATES rather than degrading
to "no grant": reporting `org_view` on a report the whole org can edit is the one
wrong answer this composition exists to prevent.

`sharing` is present for every reader, not only the owner. It is strictly coarser
than the `acl` block ADR-0059 §3 withholds — it collapses every advanced mode to
`null` — and it is the same claim the dashboard badge already makes to every
member for every row they can see.

## Consequences

- **Good:** the reported bug is fixed through the paths that already exist —
  a colleague now sees *and can open* the reports in a shared folder because
  those reports' real `Acl`s changed. No new door into content, no second source
  of truth for a report's reach, no viewer change. The read/write choice is
  expressible at org scope for the first time, and report-level sharing finally
  has the dashboard control the folder surface got in ADR-0076's amendment.
- **Trade-off — org-write is COARSE.** `org_edit` means **every** member of the
  org can edit the report; there is no middle setting between "one named person"
  and "everyone here". **Personal write grants remain the precise tool** and are
  not superseded — the two compose (an org-write report can still carry named
  cross-org grantees). If a real need for role- or group-scoped write appears,
  it layers onto the same `canWrite` seam this ADR just widened, exactly as this
  ADR layered onto ADR-0060's.
- **Trade-off — the bulk apply is N calls, not one.** Fine at current report
  counts, and every one of them is the authorized, audited call it should be. A
  batched *use case* is the fix if it ever matters — never recursive SQL under
  the guard.
- **Trade-off — the candidate rule is conservative, and will sometimes skip
  what the operator meant.** A folder of reports owned by three people bulk-
  applies only the actor's own. The skip list names every one of them with a
  reason, which is the honest failure mode; silently changing a colleague's
  report would not be.
- **Trade-off — inheritance makes the destination folder matter at upload time
  in a way it did not before.** The Root carve-out keeps the default path
  unchanged, and the change is create-time only (Decision 7), so no existing
  report's sharing moves under anyone.
- **Not addressed:** person-level folder shares reaching reports (the
  `allowlist` mapping) — deliberately out of v1 scope, tracked as **issue
  #242**. The dead `folder_collaborators` + `grant_level` schema remains awaiting
  its cleanup migration (unchanged from ADR-0060/0076); the new
  `report_org_write_grants` table must not be confused with it.

## More information

Implementation: `OrgWriteGrantStore` port modeled on `WriteGrantStore`, with a
Drizzle adapter, an in-memory fake, and a port-contract suite run on both
runners (ADR-0046); the `canWrite` third leg in
`packages/application/src/load-owned.ts`; `setReportSharing` and
`applyFolderSharingToReports` use cases; the org-write prune in `setAcl`
(Decision 11), pinned by `set-acl-grant-pruning.contract.ts` on both runners;
the org-write leg in `DrizzleReportRepository.searchByOrg` and its in-memory
mirror; `withReportSharing` for the read surfaces (Decision 13); the dashboard
control in `apps/app` computed in the loader by `report-sharing.server.ts`
(components must not import `arp-domain` — its barrel pulls `node:crypto` into
the client bundle).

Glossary: **Org write grant**, **Report sharing state**, **Sharing bulk apply**
added; **Write grant** sharpened to name its personal, email-keyed scope.
