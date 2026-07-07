# ADR-0063: In-viewer editing on the viewer origin

- **Status**: Accepted — implementation gated on a `/security-review` pass before the implementation PR ships (amends ADR-0038)
- **Date**: 2026-07-07
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0038 (report viewer access & serving — **amends** it by adding a second, authenticated route profile to the viewer origin), ADR-002/ADR-013 (viewer origin isolation + security-header stack, unchanged for the public route), ADR-014 (service-worker block, unchanged), ADR-0037/ADR-0062 (upload/versioning pipeline + the ProseMirror editing model this route serves), ADR-0056 (report sharing & ACLs — access-token/unlock-cookie precedent this ADR's edit token rhymes with), ADR-0059/ADR-0060 (owner + write-grant authorization, re-checked per save), ADR-0051 (MCP OAuth 2.1 / API-key auth — no anonymous writes on any surface), ADR-012/ADR-0045 (scan gate — every save re-enters it).

## Context and problem statement

`view.<domain>/<slug>` (ADR-002/0038) is a deliberately credential-free, PSL-isolated origin that serves raw, untrusted report bytes under a strict sandbox CSP with no first-party JS and the service-worker block (ADR-014). That isolation is the whole security model: a malicious report can't reach app credentials or persist itself, because there's nothing on that origin to reach.

The editing epic (ADR-0062: a ProseMirror-based editor for report content, informed by the `spike/DECISION.md` verdict) wants users to edit their report *in place*, ideally without leaving the viewer's rendered context. That means putting an authenticated, first-party JS application — the editor — on the same origin that today exists specifically to have none. This is the central tension this ADR resolves, and it was flagged explicitly in PR #144 review: **does the enforcing/sandbox CSP have to be relaxed for the editor, and if so, how is that contained?**

## Decision drivers

- Preserve the ADR-002/013/0038 isolation guarantee for the existing public read path — zero regression, zero exception.
- Give the editor a first-party JS surface without turning the whole viewer origin into an authenticated app.
- Never let the editor execute the untrusted report bytes it's editing — those bytes are exactly what the isolation model doesn't trust.
- Reuse proven machinery (ADR-0056's app-mints/viewer-verifies token pattern) instead of inventing a new trust primitive.
- Every write path (dashboard, viewer edit route, MCP, ADR-0051) enforces auth and `canWrite` (ADR-0059/0060) server-side — UI is never the boundary.
- Ship gated on independent security review, given the sensitivity of adding auth + JS to an intentionally-bare origin.

## Considered options

- **Two CSP profiles on one origin, edit route only** *(chosen)* — public route (`GET /<slug>`) stays exactly as today; a new `GET /<slug>/edit` route serves the editor under a separate, controlled CSP. Only the edit route ever gains first-party JS.
- **Relax the public route's CSP to allow the editor bundle everywhere** (rejected — reopens the sandbox for every reader of every report, not just an authenticated owner/grantee actively editing; the isolation guarantee would degrade to "usually not exploited" instead of "structurally can't be").
- **Move editing entirely to the dashboard origin (`app.<domain>`), no in-viewer editing** (documented as the fallback — see Decision 3 — preserved as the answer if security review rejects the in-viewer route).
- **Full Clerk session on the viewer origin** (rejected — see Decision 3).

## Decision outcome

### 1. The CSP question, answered up front

The enforcing/sandbox CSP for the **public** route does **not** relax, at all. A second, separate CSP profile is introduced, scoped **only** to the new `GET /<slug>/edit` route:

- `script-src 'self'` plus build-time hashes for the editor bundle (no `unsafe-inline`, no `unsafe-eval`) — first-party editor JS only, nothing report-supplied.
- `connect-src` limited to the app-origin API (`app.<domain>/api/v1/...` — the token-mint and save endpoints), nothing else.
- `worker-src`, `frame-ancestors`, `object-src`, and the rest of the ADR-013 stack carry over from the public profile — the edit route is *additive* (it gains a script allowance the public route doesn't have), never a general loosening.
- The two profiles are selected by route, computed independently, and there is no code path where a public `GET /<slug>` request can receive the edit-route CSP or vice versa. e2e security-header tests assert both profiles independently (see Consequences).

This containment is the answer to the PR #144 question: yes, the sandbox CSP is relaxed, but *only* for one authenticated route, *only* for a first-party bundle, and the public read path — still the overwhelming majority of viewer traffic — is untouched byte-for-byte.

### 2. Two route profiles, never mixed

- **`GET /<slug>` (public, unchanged)**: no auth, no first-party JS, the existing strict sandbox CSP, the ADR-014 service-worker block, the full ADR-0038 state machine (200/404/410/451, `noindex`). Nothing in this ADR touches this route's behavior or headers.
- **`GET /<slug>/edit` (new, authenticated)**: serves the editor application bundle under the CSP profile in Decision 1. Requires a valid edit token (Decision 3). The edit route is the **only** place the viewer origin gains first-party JS or an authenticated session concept — no other route on `view.<domain>` changes.

### 3. Auth: a scoped edit token, minted by the app

Chosen mechanism, deliberately rhyming with ADR-0056's access-token / unlock-cookie pattern: the dashboard (`app.<domain>`, Clerk session) mints a **short-lived, single-report, single-purpose edit token** when a user with `canWrite` on a report (ADR-0059/0060: `isOwner OR hasWriteGrant`) opens the editor. The viewer's edit route validates the token's signature and scope (slug-bound, purpose-bound, exp-bounded — same HMAC-compact codec family as the `Access token`), then **re-checks `canWrite` server-side on every save**, not just at token-mint time — a grant revoked mid-session stops working on the next write, not just the next token mint.

Considered and rejected:
- **Full Clerk session on the viewer origin** — would put the entire authenticated session (cookies, whatever Clerk needs client-side) on the untrusted-content origin, enlarging the blast radius of any future viewer-origin compromise to "attacker can act as the signed-in user," not just "attacker can read/write via a narrow, purpose-bound token." Rejected outright, independent of the security-review outcome.
- **Dashboard-origin editing with a deep-link fallback** — edit entirely on `app.<domain>` (which already has Clerk + full first-party JS), with the viewer's `/edit` route (if it exists at all) merely deep-linking there. Documented here as **the fallback if `/security-review` rejects in-viewer editing** — it preserves the UX goal (one click from the report to editing it) at the cost of leaving the viewer origin's read-only posture completely alone, at zero new viewer auth surface.

### 4. Saves re-enter the existing pipeline — no mutate-in-place

An edit-save does not mutate stored bytes directly. It produces a **new `ReportVersion`** through the same R2-first/commit-last pipeline as any other upload (ADR-0037, and the versioning extension in ADR-0062): write to R2, run the ADR-012 scan gate, and only promote to `live_version_id` on a `clean` verdict (ADR-0045's async pipeline). A malicious or corrupted edit cannot go live unscanned — the scan gate that already protects uploads protects edits identically, with no special-case bypass for the edit route.

### 5. No anonymous writes, on any surface

Enforcement of auth and `canWrite` lives server-side in the use cases (401 unauthenticated / 403 not-authorized), independent of transport: the REST API, the new viewer edit route, and MCP (ADR-0051 — every MCP write call carries OAuth 2.1 or an `arp_` API-key Bearer) all funnel through the same authorization check. UI-level hiding of the edit affordance is never treated as a security boundary. Correspondingly, the **public** `GET /<slug>` route never serves editor JS, comment data (ADR-0064), or any edit affordance — those exist only behind `/edit`.

### 6. ADR-014 is unchanged, including for future collaboration

The service-worker registration block stays in force on the viewer origin, for both routes, with no carve-out for the edit route. This includes any future real-time collaboration transport (ADR-0067, not yet written) — a collab layer must not register a service worker on `view.<domain>` to get around this; if it needs background delivery, it does so through the app-origin API, not a viewer-origin service worker.

## Consequences

**Positive**

- The public read path — still most of the traffic — is provably untouched: same CSP, same headers, same state machine, same absence of JS.
- The isolation break is contained to exactly one route, one CSP profile, and one narrowly-scoped token — not a general credential.
- Saves reuse the existing scan-gated, versioned pipeline; there is no new "fast path" that skips moderation.
- Rhyming the edit token with the ADR-0056 access-token codec means no new signing primitive, just a new claims shape and purpose tag.

**Negative / risk delta (stated honestly)**

- The viewer origin gains an authenticated, first-party-JS-bearing route for the first time since ADR-002. This is a real, non-zero increase in that origin's attack surface, even though it's contained to `/edit`. That is exactly why this ADR's Status is gated on an independent `/security-review` pass before the implementation PR ships — this document records the intended design, not a green light to build without that review.
- e2e security-header tests must now cover **both** CSP profiles explicitly (today's suite only asserts the public stack, ADR-013) — a regression that silently applies the edit-route CSP to the public route (or vice versa) must fail CI.
- If a report is ever submitted to the Public Suffix List (PSL) as a distinct isolation boundary, the existence of an authenticated sub-route under the same eTLD+1 as the public content is a fact that submission reviewers may reasonably ask about; this ADR is the reference for how the exception is bounded.
- The dashboard-origin fallback (Decision 3) is a real, ready-to-ship alternative if security review finds the in-viewer token model unacceptable — it is not a hypothetical, it should be treated as a live option during that review.

## More information

- Implementation: the edit-route CSP profile and its e2e header assertions live alongside the existing ADR-013 `secureHeaders()` helper (as a second, route-selected profile, not a fork); the edit-token codec extends the ADR-0056 `packages/domain/src/signed-token.ts` shared primitive with an `edit` claims shape (slug, purpose, exp) parallel to `AccessClaims`.
- ADR-0062 owns the ProseMirror schema and the parse-to-model / model-to-HTML boundary this route relies on (Decision 2 of this ADR: the editor renders the model, never the raw blob).
- `docs/context-map.md` / `docs/domain-glossary.md`: no new bounded context here — this is a serving/access-model decision inside Reports & Folders, alongside ADR-0038/0056. Any new terms this ADR needs (e.g. **Edit token**) are added to the glossary in this PR's integration step, per the CLAUDE.md same-PR rule.
