# ADR-0056: Report sharing & ACLs — app-authorized, viewer-verified access tokens

- **Status**: Accepted
- **Date**: 2026-06-24
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0038 (viewer access & serving — extends it from public-only to private modes), ADR-002 (PSL origin isolation), ADR-009 (folder-inherited grants), ADR-0036 (DDD — `Acl` ∈ `Report` aggregate, `Collaborator` ∈ `Folder`), ADR-0052 (External Ids — `grant_`), ADR-0053 (Stripe wire conventions), ADR-0040 (RFC-9457 errors), ADR-0016 (`acl:write` scope), ADR-0048/0054 (Clerk webhooks).

## Context and problem statement

Today every published, clean report is **fully public to anyone with the slug** (ADR-0038: `public` is the only live mode; the slug is the capability). The schema (`acls`, `folder_collaborators`), the `AclMode`/`GrantLevel` enums, and the `grant_` id prefix exist but have **zero behavioral code**. We want real sharing: per-report view-access modes (`public`/`password`/`org`/`allowlist`) **and** folder collaborators (`editor`/`admin` write grants, cross-org, tree-inherited). The hard constraint: the viewer lives on a **PSL-isolated, credential-free origin** (`view.<domain>`, ADR-002/0038) that must never hold app/Clerk credentials, yet it must enforce access.

## Decision drivers

- Preserve the ADR-002/0038 origin isolation (no app/Clerk creds on the untrusted-content origin).
- One enforcement primitive that works for all private modes + the whole report bundle (entry + assets).
- Align with the aggregate boundaries (ADR-0036) and the wire/id/error conventions (ADR-0052/0053/0040).

## Considered options

- **Enforcement**: app-authorizes / viewer-verifies a signed access token *(chosen)* · Clerk auth *on* the view origin (rejected — breaks ADR-002/0038 isolation) · app proxies all bytes (rejected — abandons the direct view-origin serve model, adds latency/egress).
- **Token format**: HMAC compact *(chosen)* · JWT via `jose` (rejected — needless dep for an internal token).
- **Bundle gating**: report-scoped unlock cookie *(chosen)* · token-in-URL only (rejected — assets ungated) · sign every asset URL (rejected — mangles arbitrary user HTML).
- **`Acl` modeling**: aggregate member of `Report`, loaded on single reads *(chosen, ADR-0036)* · a separate `AclRepository` (rejected — an aggregate member isn't its own repo).
- **Serving layer**: keep the Vercel viewer as the R2-masking gateway *(chosen)* · a dedicated Cloudflare-Worker edge gateway (deferred to a separate ADR — a cost/perf re-platform, orthogonal to ACLs).

## Decision outcome

1. **Enforcement model: the app authorizes, the viewer verifies** (keystone). For a non-`public` report the viewer redirects to `app.<domain>`, which holds Clerk + runs the ACL check **by mode**, then mints a short-lived signed **access token** and redirects back to `view.<domain>/<slug>?access=…`. The viewer only ever **verifies a signature** — it never holds Clerk credentials. (Rejected: Clerk auth *on* the view origin — breaks isolation; app proxying the bytes — abandons the direct-serve model.)
2. **Access token: HMAC-signed compact, slug-bound, ~15-min, stateless.** `base64url({slug, exp}) + "." + HMAC-SHA256(payload, secret)`. No JWT dep. A shared **`VIEW_ACCESS_TOKEN_SECRET`** (app mints / view verifies), wired via Terraform onto both projects. Stateless (exp-bounded, not single-use) — the `allowlist` *magic-link* token (P3) is separately single-use.
3. **`Acl` is an aggregate member of `Report`** (ADR-0036). Loaded on single-report reads (`findBySlug`/`findById`) via a LEFT JOIN on `acls`; **missing row ⇒ `public`** (no backfill, creation inserts nothing). **List reads (`searchByOrg`) do not load it.** Enforcement is modeled as a **combinable** check — `report.acl allows` **OR** `requester holds a folder grant covering the report` (P4) — so folder collaborators slot in without reshaping P1.
4. **The viewer is the R2-masking gateway** (it already streams bytes from private R2; R2 URLs are never public). The full bundle (entry **and** assets, fetched via relative URLs) is gated by a **report-scoped, short-lived, HttpOnly unlock cookie** that the viewer sets after verifying the access token. The cookie is a **self-issued per-report capability, NOT Clerk/app credentials** — so ADR-002/0038 isolation holds. Token (URL, one-time hand-off) → unlock cookie (per-request credential for the rest). (A dedicated Cloudflare-Worker edge gateway in front of R2 for cost/perf is a **separate** future ADR, not part of this work.)
5. **Conventions:** `set_acl` etc. follow the Stripe envelope (ADR-0053); errors RFC-9457 (ADR-0040); `acl:write` scope enforced at the use case (ADR-0016); folder grants use the `grant_` External Id (ADR-0052). The password hash (argon2id, per db-design) and never-on-the-wire secrets stay off every response (ADR-0053 §12 redaction).

## Phased delivery

- **P1 — Foundation + `public`/`password`:** the `Acl` value object + load (JOIN, default-public); `setAcl` use case (`acl:write`); `set_acl` API; access-token mint (app) + verify (view); the password flow (viewer form → app verifies argon2id → token → unlock cookie). New: argon2id dep, `VIEW_ACCESS_TOKEN_SECRET`.
- **P2 — `org`:** the redirect handshake → app checks the Clerk session's org == the report's org → token.
- **P3 — `allowlist`:** magic-link email (Resend) → app verifies → token. The link token is single-use; the access token stays stateless. **Redemption is POST-only** — the `?link=` GET renders a confirm interstitial and the state change (consume the nonce + create the grant) happens only on the submitted POST, so an email link scanner's unsolicited GET (Outlook SafeLinks / Gmail prefetch / AV sandboxes) can't burn the one-time nonce before the user clicks. Revocation is **stateful** (revocation-C): a durable `report_grants` row, checked live per viewer request, deleted on email-removal / mode-change.
- **P4 — Folder collaborators:** `folder_collaborators` repo + grant/revoke (`grant_` id, `acl:write`/admin) + tree-walk inheritance + the combinable access check.
- **P5 — Cross-context resolution:** `UserCreated` (Clerk `user.created` webhook) → resolve pending `grantee_email` → `UserId`; `AclChanged`/`CollaboratorGranted` domain events.

## Per-phase decisions deferred to their phase (with leanings)

- `set_acl` API shape — the `acl` is a sub-resource of the report (no own id; 1:1 `acls`). Lean: `POST /api/v1/reports/{slug}/acl` returning the report resource with an embedded `acl` block. **Resolved (PR #118):** the embedded `acl` block omits `object`; the standalone `GET /api/v1/reports/{slug}/acl` returns it as an `{ object: "acl", … }` resource (ADR-0053 discriminator). The `reports_get_acl` / `reports_set_acl` MCP tools wrap these.
- Org handshake route + UX; allowlist link TTL (lean ~24h link, ~15-min access token) + single-use store; folder-grant inheritance read cost (walk vs cache); the outbox/event plumbing for P5 (only 3 domain events exist today).

## Consequences

- **Good:** one primitive (app-mint / view-verify token + unlock cookie) covers all modes + the full bundle; isolation preserved; aggregate boundaries respected; no schema migration for P1 (default-public-on-missing).
- **Trade-offs:** a redirect handshake on first private access (then the cookie carries it); a new shared signing secret; the viewer now issues its own per-report cookie (a deliberate, documented relaxation — capability, not credentials); argon2id dep; folder-grant inheritance (P4) adds read-time cost to authz.

## More information

Implementation: `Acl` in `packages/domain`; the access-token codec (HMAC) shared by `apps/app` (mint) + `apps/view` (verify); `setAcl` use case + `ReportRepository.setAcl` + JOIN-on-read in `packages/adapters`; the `set_acl` route + the app authorize/mint endpoints; the viewer enforcement + unlock cookie + password form; argon2id hasher adapter; `VIEW_ACCESS_TOKEN_SECRET` via Terraform. Glossary gains **Access token**, **Unlock cookie**, and sharpens **Acl**/**Collaborator**.
