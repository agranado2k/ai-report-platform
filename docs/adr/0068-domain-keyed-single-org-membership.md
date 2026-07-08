# ADR-0068: Domain-keyed single-org membership — the G4 scope decisions

- **Status**: Accepted
- **Date**: 2026-07-08
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0061 (org types & membership — resolves its deferred decisions and **amends** its implied multi-org membership), ADR-0048 (JIT provisioning — extended to domain orgs), ADR-0059 (per-user ownership — the transfer prerequisite is **deferred**, see §4), ADR-0056 P2 (the org handshake's semantics are settled by §1), ADR-017 (everything-as-code — one accepted fixture exception, §6).

## Context and problem statement

The G4 scoping PRD (issue #141) surfaced six deferred decisions blocking the team-orgs build. The operator answered all six on 2026-07-08. One answer changes the membership model itself — a user belongs to exactly **one** org, keyed by their email domain — which dissolves the hardest open question (active-org vs cross-org membership checks) and reshapes provisioning. This ADR records the decisions; the build follows it.

## Decision drivers

- Remove the multi-org ambiguity from every authorization path cheaply, without live Clerk membership calls on the unlock path.
- Reuse the proven ADR-0048 JIT provisioning shape rather than adding invitation UI in this epic.
- Ship the smallest team-org surface that makes org-mode sharing real; defer UI and transfer machinery until real usage informs them.

## Considered options

Per decision point, the PRD's options were weighed; the choices below supersede the leans recorded in ADR-0061 where they differ.

## Decision outcome

1. **One user, one org — keyed by email domain.** A user belongs to exactly one org, derived from their email: a **corporate domain** (e.g. `arthur@housenumbers.io`) maps to that domain's team org (`housenumbers.io`) — which is **multi-member by design**: every user at that domain lands in the same org (`arthur@` and `my_coworker@housenumbers.io` are colleagues in one `housenumbers.io` org). A **public-provider address** (e.g. `agranado2k@gmail.com`) maps to a personal org keyed by the full address (personal orgs stay 1:1, ADR-0048). So the constraint is per-USER (each user has exactly one org), never per-org (domain orgs grow with every same-domain sign-up). This requires a **public-provider domain list** (gmail.com, outlook.com, etc. → personal org; everything else → domain org) — the implementation must maintain it explicitly. Consequences: the session's org is always the user's *only* org, so the org-mode unlock's active-org check (`orgUnlock`, PR #150) is **correct by construction** — no Clerk membership call, no org switcher needed in this epic. Multi-org membership is explicitly **revisit-later**; the `orgUnlock` seam and the mirror keep working unchanged when it arrives.
2. **Roles: Clerk custom-roles infrastructure, with only `admin` and `member` defined.** The custom-roles door stays open; nothing beyond the two roles ships now. Role powers remain minimal per ADR-0059/0061: membership management only — never content access.
3. **Team-org creation is JIT at first sign-up** (extends ADR-0048): on a user's first sign-in, provisioning derives the org key from their email domain — join the existing domain org if it exists, else create it (script/API against Clerk, mirrored through the existing webhook/provisioning layer). No manual dashboard step, no self-serve creation UI in this epic.
4. **Ownership transfer is DEFERRED.** ADR-0059/0061 named it a team-org launch prerequisite; the operator explicitly waives that for now. **Accepted risk:** in a team org, a departed or soft-deleted member's reports become permanently read-only (delete/set_acl/grant management are owner-only; `reports.owner_id` is `ON DELETE RESTRICT`) until a transfer story ships. Revisit before onboarding any team whose churn would make this bite.
5. **Org-mode sharing stays API/MCP-only (fast-follow UI).** No share dialog ships in G4; the dashboard share surface is a separate later slice, designed against real usage.
6. **The two-member e2e fixture is hand-provisioned** — `silver+clerk_test@agranado.com` was created on the dev Clerk instance by the operator (Clerk `+clerk_test` test-mode address). **Accepted ADR-017 exception** (a clicked fixture, not code): document the fixture's identifiers in the e2e env/docs so it is reconstructable, and treat any drift as a fixture bug, not a test bug. Note the address's domain (`agranado.com`) makes it a *domain-org* user under §1 — convenient for team-org scenarios, but the fixture docs must state which org it is expected to land in.

## Consequences

- **Good:** the unlock path stays fast and offline-from-Clerk; provisioning reuses a proven shape; G4 shrinks to backend + mirror + fixture — no invitation UI, no switcher, no transfer machinery.
- **Trade-offs:** domain-keyed auto-join means **anyone who verifies an email at a corporate domain joins that domain's org** and gains member-level visibility (org reports' metadata; org-mode-shared content) — acceptable for the invite-only MVP, but revisit alongside multi-org. The transfer deferral (§4) is a real operational hole in team orgs. The hand-provisioned fixture can rot (cf. the ADR-0049 instance-hygiene incident) — reconstruction steps are part of its documentation.
- ADR-0061's `orgs.kind` column stands; the kind is now *derived at provisioning* from the domain rule rather than chosen by a creation flow.

## More information

**Implementation notes (2026-07-08, PR #158 + its review wave)** — resolutions made while building this ADR's order, recorded here because the diary is not a decision source:

- **Membership-mirroring webhooks: deliberately NOT wired.** No local membership table exists (all gates check Clerk live), and under §1/§3's JIT join-or-create an `organizationMembership.deleted` handler is a placebo — a "removed" member auto-rejoins on their next sign-in because their email still matches the domain. Real member removal requires don't-auto-rejoin machinery (tracked as a follow-up issue); wiring the webhook without it would fake a closed gap.
- **The Clerk org slug carries a short domain-hash suffix and orgs anchor their true domain in `publicMetadata.domain`**, verified (fail-closed) before any JIT join — a bare dot→hyphen slug is not injective (`my-company.com` ≡ `my.company.com`), and a slug collision under auto-join is a tenant-boundary crossing (registrable-domain variant: `acme-co.uk` vs `acme.co.uk`).
- **Verified emails only**: the OAuth provision path uses only `verification.status === "verified"` addresses; the session path's email claim depends on the Clerk instance blocking unverified sign-ins — a **hard configuration dependency of this ADR** (an unverified address would let anyone claim a victim domain).
- **Org membership is sticky**: a user's org is resolved at first provision and never re-keyed — a later email/domain change does NOT migrate them (they keep their original org). Accepted; revisit with multi-org.
- **Cutover semantics**: any user who signed up at a corporate domain BEFORE the team branch existed owns a personal org; post-cutover their no-active-org sessions would mint a separate team org (split-brain). Pre-deploy check: verify no prod user has a non-public-provider email (one SQL query); today the operator expects zero.

Build order implied: provisioning (domain rule + public-provider list + JIT domain-org) → membership mirroring (Clerk webhooks beyond `user.deleted`) → fixture-backed e2e (un-`@wip` the sharing scenarios) → org-mode share UX and ownership transfer as separate later slices. G4's migration claims the next free number at PR time (0013+ — mind the parallel-epic numbering race, cf. the PR #150 renumber). Glossary: **Org** gains the domain-keyed membership rule.
