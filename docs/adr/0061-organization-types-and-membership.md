# ADR-0061: Organization types & membership — personal and team orgs

- **Status**: Accepted (scope decision; implementation details deferred to its build phase)
- **Date**: 2026-07-06
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-005 (Clerk Organizations from day 1 — this activates the dormant half), ADR-0048 (JIT personal-org provisioning — unchanged for personal orgs), ADR-0059 (per-user ownership — **hard safety prerequisite**), ADR-0056 P2 (`org` ACL mode — becomes meaningful), ADR-0054 (user soft-delete — ownership transfer).

## Context and problem statement

Every org today is a 1:1 JIT-provisioned personal org (ADR-0048). The target model distinguishes a **personal organization** (one member, allowlist/password sharing) from a **company organization** (many members; a report owner can additionally share to *everyone in the company* via the `org` ACL mode, and colleagues see org reports' metadata). The tenancy machinery (Clerk Organizations, org-scoped tables) has been in place since ADR-005; what's missing is membership itself — invitations, an org switcher, and the distinction between the two org kinds.

## Decision drivers

- The target sharing model distinguishes personal workspaces from companies ("share to everyone in the company") — that needs real multi-member orgs.
- ADR-0059's per-user ownership must be the deployed reality before the first second member joins any org (safety sequencing).
- Don't rebuild what Clerk provides (invitations, memberships, switcher UI) — ADR-0048 already made Clerk the identity source of truth.
- Existing users must be untouched: personal orgs keep JIT provisioning and never grow.

## Considered options

- **Two explicit org kinds (`personal`/`team`), membership mirrored from Clerk** *(chosen)*.
- No kind column — infer "team" from member count (rejected — a personal org would silently become a team org by invitation; the kind is a product decision, not an emergent property).
- Own membership tables + invitation flow (rejected — duplicates Clerk; the webhook ACL mirror already exists for users/orgs).
- Org admins get content access to members' reports (rejected — operator chose owner-only privacy, ADR-0059).

## Decision outcome

1. **Two org kinds: `personal` and `team`**, persisted as `orgs.kind` (new enum column, default `personal`). Personal orgs keep ADR-0048 JIT provisioning unchanged and never gain members. Team orgs are created explicitly and grow via invitations.
2. **Membership via Clerk** (invitations, membership records, the `<OrganizationSwitcher />` surface) mirrored through the existing webhook anti-corruption layer — consistent with ADR-0048's "Clerk is the identity source of truth". No parallel membership table unless mirroring proves insufficient.
3. **Permission model in a team org** (per ADR-0059/0060 — restated here as the org-facing contract): members see org reports' **metadata** in lists; content access follows the report's `Acl` (owner-only when `private`, everyone-in-org when `org` mode, etc.); writes are owner + write-grantees; org **admins get no content superpowers** — their admin surface is membership + (future) ownership transfer.
4. **Hard sequencing constraint:** ADR-0059 must be **fully deployed and backfilled before the first multi-member org exists** — otherwise org-checked writes are cross-user writes. CI/e2e should cover a two-member org fixture before launch.
5. **Prerequisite story: ownership transfer.** Before a team org launches, an owner-departs path must exist (transfer on user delete/leave — flagged in ADR-0059 / ADR-0054). Admin-initiated reassign of a departed member's reports is the lean choice; it moves *ownership*, never grants content view of a live member's private reports.

## Deferred to the build phase (with leanings)

Invitation UX and roles (lean: Clerk defaults, admin/member only); whether team-org creation is self-serve or plan-gated (lean: plan-gated later, manual first); `org` ACL mode UX in the share dialog; quota semantics for team orgs (`PlanLimits` are org-scoped already); the two-member e2e fixture on the dev Clerk instance.

## Consequences

- **Good:** the personal/company split in the product model becomes real; ADR-005's day-1 investment pays off; nothing changes for existing users.
- **Trade-offs:** a second org kind adds a branch to provisioning and settings UI; Clerk membership webhooks become load-bearing (mirror lag = stale membership checks — the `org`-mode viewer handshake reads the live Clerk session, which bounds staleness for view access).

## More information

This is a scope decision: it fixes the org model (`kind`, Clerk-mirrored membership, the permission contract restated from ADR-0059/0060) so the ownership epic can proceed, and defers build details to its implementation phase (see "Deferred to the build phase" above). The `orgs.kind` column and the two-member e2e fixture land with that build, not with this ADR. Sequencing is tracked in the epic issue; the hard constraint is §4 — ADR-0059 deployed and backfilled first.
