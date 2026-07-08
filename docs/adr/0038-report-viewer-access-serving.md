# ADR-0038: Report viewer access & serving model

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: agranado2k
- **Supersedes / amends**: refines the viewer flow in `docs/spec.html` (rev 8); complements ADR-002 (separate viewer origin), ADR-013 (security headers), ADR-0037 (upload pipeline).
- **Superseded by**: —

## Context and problem statement

`view.<domain>/<slug>` serves untrusted hosted content. ADR-002/013 fix the *origin isolation and header* posture; this ADR fixes the **access and serving semantics**: what access state a brand-new report has, what the viewer returns in each report/version state, and how `?v=N` (non-live version access) behaves. These are security-sensitive (info leakage, accidental exposure) and define the public contract of the viewer, so they're decided up front.

## Decision drivers

- The value prop: a report yields a permanent, shareable URL (ADR-001).
- Phase 1 ships **public-mode ACL only** (spec progress tracker); richer modes come later.
- Fail-closed where exposure is at stake; don't tip off abusers or expose an owner's moderation status.
- The viewer is on a separate PSL-isolated origin (ADR-002) with no shared dashboard session — it must apply **one uniform gate** regardless of requester.

## Decision outcome

### 1. Default access: public capability-URL

A newly created report defaults to `acl.mode = public` (the only mode in Phase 1). In `public` mode the access gate **is** the `slug` — a `nanoid(10)` with ~64¹⁰ ≈ 10¹⁸ of entropy, i.e. an unguessable **capability**: "anyone with the link," like an unlisted paste, **not** "discoverable." The viewer always sends `X-Robots-Tag: noindex` so public ≠ crawlable. Private modes (`password`/`org`/`allowlist`) are later opt-in via `set_acl`.

This is a deliberate **security stance**: uploads are link-shareable by default, which must be explicit in the UI and docs. The scan gate still applies — a report isn't served until a version is `clean` (ADR-0037 §8).

New framing: `Slug` is a **capability credential**, not merely an identifier (see glossary).

### 2. Viewer state machine for `GET /<slug>` (and `?v=N`)

Differentiated but **reason-opaque**:

| State | Response |
|---|---|
| clean live version (or clean `?v=N`) passing ACL | `200`, stream from R2, full ADR-013 header stack, `noindex` |
| report exists, no live version yet, newest pending | `200` **"scanning… check back"** holding page (auto-refresh, `noindex`) |
| relevant version `flagged` | `451` "unavailable — flagged for review" (no detail) |
| version `blocked`, **or** unknown slug | `404` (indistinguishable — don't acknowledge serious-bad content) |
| report taken down (`deleted_at`) | `410 Gone` "no longer available" (no public reason) |

This gives the Journey-1 "scanning…" UX and takedown hygiene without advertising *why* content was actioned (which would tip off abusers and expose owners). The only intentional leak is the existence of a pending report to a link-holder — acceptable, since the slug is a capability the owner chose to share.

### 3. `?v=N` access to non-live versions

`?v=N` passes through the **same ACL + the same scan-status state machine** as the live URL. Any `clean` version is served to anyone who passes the report's ACL; `pending`/`flagged`/`blocked`/unknown-`N` follow the table above; a taken-down report returns `410` at any `N`. The version ordinal (1, 2, 3…) is **low-entropy and enumerable**, but the `slug` is the capability, so `?v=N` grants nothing beyond what the slug already does. Owner inspection of **non-clean** versions happens in the dashboard (`app.<domain>`), never the public viewer (which can't cheaply identify the owner cross-origin). Cheap to ship in Phase 1: the loader resolves `N` instead of `live_version_id` through the identical gate.

### Consequences

**Positive**
- One uniform gate; the viewer needs no cross-origin identity.
- Reason-opaque responses balance UX, transparency, and abuse-resistance.
- `noindex` + capability slug gives "unlisted" semantics with minimal machinery.

**Negative**
- Public-by-default is a footgun if users assume privacy — must be surfaced loudly in UI/docs.
- Distinct codes (451/404/410) are a small contract surface clients may depend on.

**Neutral**
- Owner preview of flagged content is deferred to the dashboard, out of this ADR's scope.

## Considered options (key forks)

- **Default access**: public capability + `noindex` *(chosen)* vs draft/unshared-until-`set_acl` (fail-closed, +1 step per create) vs org-only default (front-loads cross-origin membership checks).
- **Viewer states**: differentiated reason-opaque *(chosen)* vs opaque 200/404-only (no scanning UX) vs fully transparent (advertises moderation reasons).
- **`?v=N`**: same ACL+scan gate *(chosen)* vs owner/org-only history vs defer `?v=N`.

## More information

- `docs/spec.html` rev 8 — viewer flow.
- Related: ADR-001, ADR-002 (separate origin + PSL + `__Host-` cookies), ADR-012 (scan states), ADR-013 (header stack), ADR-0037 (promotion → `live_version_id`).
- `docs/domain-glossary.md` — `Slug` (capability), `Live version`, `Acl`, `Scan status`.

### Amendment (2026-07-08): the holding page sits behind the Acl gate

§2's "intentional leak" rationale — *"the existence of a pending report to a link-holder
[is] acceptable, since the slug is a capability the owner chose to share"* — predates
ADR-0056, under which reports are **private by default** and a slug is no longer
necessarily an owner-shared capability. A post-merge dogfood run (2026-07-08) showed the
viewer serving the `200` scanning holding page **before** the ADR-0056 access decision,
so a private report revealed its existence and scan state to any slug-holder during the
scan window (a `200`-vs-`302`/`404` oracle), while the same visitor would be denied once
the scan completed.

Amended behavior: the viewer computes the ADR-0056 access decision **first** for both
servable and `scanning` outcomes; the holding page is only shown to visitors the report's
mode admits (owner via the `/open` hand-off, org members, grantees — or anyone, for
`public`). Everyone else gets the same unlock redirect they would get for the clean
version. The §2 state table is otherwise unchanged, and `deleted`/`flagged`/`notfound`
(410/451/404) remain pre-gate, reason-opaque terminal states as documented contract.
