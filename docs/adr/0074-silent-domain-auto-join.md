# ADR-0074: Silent domain auto-join — the app-owned domain index replaces slug keying

- **Status**: Accepted
- **Date**: 2026-08-01
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0068 (domain-keyed single-org membership — this ADR fixes its broken join key and narrows its session-org trust), ADR-0048 (JIT provisioning — one recorded deviation: the ORG row now lands at webhook time), ADR-0054 (the webhook endpoint this extends beyond `user.deleted`).

## Context and problem statement

ADR-0068 promised that every sign-up at a corporate email domain silently joins that domain's team org. Production broke that promise twice over (verified live against the prod Clerk instance):

1. **The join key was dead code.** The adapter looked team orgs up by a deterministic domain-derived slug — but the prod instance runs `slug_disabled: true`, so Clerk auto-generates slugs (`house-numbers-1785…`) and the deterministic slug can never exist. The test fake keyed orgs by a domain Map, structurally unable to represent "an org exists but the slug lookup misses", which is how the bug shipped.
2. **Clerk's forced org-selection task outruns our provisioning.** `force_organization_selection: true` pushes every new user through a create/choose-org task at sign-up — before first-write JIT provisioning ever executes — and the old code trusted any session-carried org unconditionally, so a second same-domain user who created a duplicate org in that task kept it forever.

The natural fix — Clerk organization domains (instance-wide verified-domain uniqueness + enrollment) — is **402-gated**: `PATCH /instance/organization_settings {"domains_enabled": true}` returns HTTP 402 on the free prod instance. Verified Domains and automatic invitations live in Clerk's **B2B Authentication add-on ($100/mo, $85/mo annual; the $25/mo Pro plan does NOT include it)**. So Clerk cannot be the join key. What IS free: organizations, memberships (instance default cap raised 5 → 20 via the API, no charge), organization metadata, and webhooks — everything the architecture below needs.

## Decision drivers

- An email at an existing org's domain must join that org **silently** — no invitation click, no duplicate-org screen (the `processing@housenumbers.io` incident).
- One-domain-one-org must be a real invariant, enforced somewhere with uniqueness semantics — not a convention.
- No new spend: stay on Clerk's free tier; the $100/mo add-on buys nothing our requirement needs.
- One resolution path: the webhook and first-write JIT must be structurally unable to disagree on which org a domain maps to.
- Fail closed on any tenant-boundary ambiguity (a wrong join is a cross-tenant breach).
- Keep ADR-0048's cost posture: no personal-org pre-creation at sign-up (retained-org pricing), no user-row mirroring before first write.

## Considered options

1. **Clerk organization domains + `automatic_invitation`** — rejected: 402 on the free plan; even paid, its best mode is a pending invitation plus a "Join" click, not a silent join.
2. **Buy the B2B Authentication add-on ($100/mo)** — rejected for now: it would replace (a) our DB unique index with Clerk-enforced domain uniqueness, (b) the webhook-race net with invitation UX, and (c) some custom code — none of which the invite-only MVP needs. Revisit triggers below.
3. **Fix the slug keying in place** (derive slugs, keep Clerk as the key) — rejected: `slug_disabled` means we cannot set slugs at all on this instance; the scheme is unimplementable, not merely buggy.
4. **App-owned domain index in our DB + Clerk `publicMetadata.domain` as identity anchor + membership pre-granted on `user.created`** — **chosen**: every piece is free-tier, the uniqueness invariant lives in Postgres where we can actually enforce it, and the join happens server-side before the user ever sees Clerk's forced task.

## Decision outcome

**The app-owned DB index is the canonical join key.** `orgs.domain` (nullable text) carries the lowercased email domain for team orgs, with a partial unique index (`WHERE domain IS NOT NULL`) enforcing one-domain-one-org (migration 0018). Clerk-side, a team org's identity is anchored in `publicMetadata.domain`, stamped at creation and **verified fail-closed** before any index-driven join (a mismatched anchor, a null anchor, or a missing org all refuse the join loudly — a wrong join is a tenant-boundary crossing). Slug keying is deleted outright.

**One resolution chain** (`resolveCanonicalTeamOrg`), shared verbatim by the webhook and first-write JIT:

1. **DB index hit** → verify the Clerk org's anchor → `ensureMembership` (idempotent).
2. **Index miss** → bounded client-side **anchor scan** of `GET /organizations` (≤ 200 orgs, page size 100), adopting an existing unmirrored Clerk org whose anchor matches exactly — the "House Numbers" shape: org created before the index existed. Adoption records the org row (Clerk's display name, kind `team`, domain indexed). A null-anchor org is never adopted.
3. **Nothing anywhere** → create the Clerk org (name = domain, anchor stamped, **no slug**; creator auto-admin) and record its row.

**Join moves to Clerk's `user.created` webhook.** The handler pre-grants the domain-org membership the moment the user exists, so the forced org-selection task (`force_organization_selection` stays **true**) renders as select-not-create — at worst one click, never a duplicate-org screen. Only the **primary verified** email drives the join (ADR-0068's verified-emails-only invariant; an unverified or secondary address must never claim a domain — anything less acks 200 and leaves first-write JIT as the net). Personal (public-provider) addresses are a deliberate no-op: their orgs stay JIT-at-first-write per ADR-0048's cost posture.

**Recorded deviation from ADR-0048:** the webhook writes the **ORG row** (via `upsertTeamOrg`) — under this architecture the DB row IS the join index, so it must exist before the next same-domain sign-up. The **USER row still mirrors at first write**, unchanged.

**Race closure.** Clerk-side creation has no uniqueness (no slugs, no domains feature), so two racing first-sign-ups can both create Clerk orgs. The partial unique index is the closer: the loser's row write returns a typed Conflict → re-read the index → join the winner. The loser's freshly-created Clerk org stays behind unreferenced — accepted blast radius of one empty org per lost race (cf. ADR-0048's identical trade-off for personal orgs).

**Set-domain-if-null heal.** Rows mirrored before migration 0018 carry `domain = NULL` and miss the index. Both the upsert and `createIdentity` set the domain **only when currently null** (never re-keying an already-domained row), so a pre-index org heals on its first touch — House Numbers heals on its members' next write, or on the next `@housenumbers.io` sign-up via the adopt-scan.

**Session-org trust narrows to sticky-after-mirror.** A team-domain user's session-carried org is honored only when the (user, org) pair is already mirrored; on a mirror miss the session org is **ignored** and the canonical chain runs. Once mirrored, membership stays sticky (ADR-0068's no-re-keying rule, unchanged). Personal flows are untouched.

**Member-cap behavior.** The instance's default membership limit is raised to 20 (free). A cap rejection surfaces as the typed `PlanLimitExceeded`; the webhook **acks it with 200 + a structured warn** (Svix retries cannot raise a plan limit) while transient failures return 500 for retry (both handlers are idempotent).

### Revisit triggers

- **Scan bound**: the anchor scan is O(instance orgs), capped at 200, and runs at most once per domain (index misses only). Revisit if the instance approaches ~200 orgs.
- **Clerk B2B add-on ($100/mo)**: move to Verified Domains + automatic invitations when any org needs **> 20 members**, the instance approaches **> 100 multi-member orgs** (Clerk's free-tier MRO ceiling; overage prompts an upgrade with a one-month grace), or we need **custom roles** or **SSO-linked orgs**. On upgrade, Clerk's domain uniqueness becomes belt-and-braces over — not a replacement for — the DB index.

## Consequences

- **Good:** processing@'s class of bug is structurally closed — the duplicate-org path no longer exists; the invariant is enforced by Postgres; webhook and JIT cannot diverge; zero new spend.
- **Trade-offs:** we own more code than the paid feature would require; orphaned Clerk orgs can accumulate one-per-lost-race (and one per superseded anchorless dev org); the webhook now writes org rows, a carve-out from ADR-0048's first-write-only mirroring that future readers must know about (hence this ADR).
- The `user.created` wiring partially reverses ADR-0054's webhooks-beyond-`user.deleted` stance; the `organizationMembership.*` non-wiring rationale stands unchanged (a "removed" member would silently rejoin on next sign-in until a don't-auto-rejoin mechanism exists — ADR-0068 §4/§5).
- Operator dependency: the Svix endpoint's event filter must include `user.created` (dashboard-only step, documented in `docs/infra.md`).

## More information

Live facts this ADR rests on (verified 2026-07/08 against the prod instance): `slug_disabled: true`, `domains_enabled: false` + 402 on enablement, `force_organization_selection: true`, memberships free with the default cap raised to 20. Part-0 repair already applied: House Numbers (`org_3HER3n4YJjMkstzYWfq5AEEgyGV`) carries `publicMetadata.domain = "housenumbers.io"` and both current members. Implementation: migration 0018 (`orgs.domain` + `orgs_domain_uniq`), `resolveCanonicalTeamOrg` / `handleUserCreated` in `packages/application`, the re-keyed `ClerkBackendOrgProvisioner` (raw BAPI fetch for the org read/list calls — the @clerk/backend v2/v3 skew makes SDK use unreliable there), and the `clerk-webhook.server.ts` handler. The e2e smoke now asserts two same-domain identities share one org (the pre-ADR-0074 scenario deliberately accepted either outcome — that gap is closed). Glossary: **Domain auto-join**.
