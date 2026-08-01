// ClerkBackendOrgProvisioner — creates (or reuses) a personal Clerk Organization
// when a session carries no active org (ADR-0048), and resolves/creates team
// orgs for the domain auto-join flow (ADR-0068 §3, re-keyed by ADR-0074).
// Clerk doesn't auto-create personal orgs, so identity provisioning calls this;
// the creator becomes the org admin. Infra adapter (ADR-0020) behind the
// application's ClerkOrgProvisioner port.
//
// ADR-0074 re-key: team orgs are NOT looked up in Clerk anymore — the app-owned
// DB index (`orgs.domain`) is the canonical join key (Clerk organization-domains
// is 402-gated on the free plan, and the prod instance auto-generates slugs, so
// the old deterministic-slug lookup was dead code). What remains Clerk-side:
//   - `publicMetadata.domain` — the org's identity ANCHOR, stamped at creation
//     and verified (fail-closed) before any DB-index-driven join.
//   - `findOrgByAnchorScan` — a bounded org-list scan used ONLY on a DB-index
//     miss, to adopt an existing unmirrored org (e.g. one created before the
//     index existed).
import { createClerkClient } from "@clerk/backend";
import type { ClerkOrgProvisioner } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";

/** The slice of `ClerkAPIResponseError` this adapter reads. */
interface ClerkApiErrorLike {
  readonly status: number;
  readonly message: string;
  readonly errors: ReadonlyArray<{ readonly code?: string }>;
}

/** STRUCTURAL guard for Clerk API errors — deliberately NOT the SDK's
 *  `isClerkAPIResponseError`. That guard is `instanceof`-based and lives in a
 *  subpath (`@clerk/backend/errors`) whose export set differs across majors:
 *  `apps/app` resolves @clerk/backend v2 at runtime (pinned alongside
 *  @clerk/remix) while this workspace package declares v3, and v2's subpath
 *  exports no guard at all — importing it crashed EVERY app route at module
 *  load on the PR #158 preview (`SyntaxError: … does not provide an export
 *  named 'isClerkAPIResponseError'`). Even when the import resolves, an
 *  `instanceof` check silently fails across two SDK copies in one process.
 *  Both majors mark instances with `clerkError = true` + `status` +
 *  `errors[]` (set by @clerk/shared's class), so shape is the stable contract. */
function isClerkApiError(e: unknown): e is ClerkApiErrorLike {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { clerkError?: unknown }).clerkError === true &&
    typeof (e as { status?: unknown }).status === "number" &&
    typeof (e as { message?: unknown }).message === "string" &&
    Array.isArray((e as { errors?: unknown }).errors)
  );
}

/** The default Clerk system role granted to a JIT team-org joiner (ADR-0068 §2:
 *  custom-roles infra stays open, but only `admin`/`member` are used today — the
 *  creator of an org is auto-assigned `org:admin` by Clerk; every later joiner
 *  gets `org:member`). */
const TEAM_MEMBER_ROLE = "org:member";

/** Clerk error codes that mean "the org is at its membership cap" — mapped to
 *  the typed `PlanLimitExceeded` (ADR-0074) so the webhook can ack-not-retry.
 *  Matched as an explicit set plus a `_quota_exceeded` suffix (best-effort:
 *  Clerk's exact code isn't contractually documented; the suffix catches
 *  plan-quota variants without swallowing unrelated 422s like invalid_role). */
const MEMBER_CAP_CODES: ReadonlySet<string> = new Set(["organization_membership_quota_exceeded"]);
function isMemberCapCode(code: string | undefined): boolean {
  return code !== undefined && (MEMBER_CAP_CODES.has(code) || code.endsWith("_quota_exceeded"));
}

/** How deep `findOrgByAnchorScan` will look, in orgs (ADR-0074). The scan is
 *  O(instance orgs) and runs only on a DB-index miss — i.e. at most once per
 *  domain ever, on the adopt path — so the bound exists to keep a pathological
 *  miss cheap, not to serve steady-state traffic. Revisit (ADR-0074) if the
 *  instance approaches this many orgs — by then the free plan's 100-MRO
 *  ceiling forces a Clerk plan decision anyway. */
const ANCHOR_SCAN_MAX_ORGS = 200;
const ANCHOR_SCAN_PAGE_SIZE = 100;

/** The slice of the Clerk backend API we depend on — narrow so tests can fake it.
 *  `getOrganization`/`listOrganizations` return the org's `publicMetadata.domain`
 *  pre-extracted as `domainAnchor` so the port stays anchor-shaped. */
export interface ClerkOrgApi {
  createOrganization(params: {
    readonly name: string;
    readonly createdBy: string;
    /** Team orgs anchor their true domain here (`{ domain }`) so joins can
     *  verify identity (review #158 C-1, ADR-0074). Metadata is chosen over
     *  `name` as the anchor because `name` is a mutable display string. */
    readonly publicMetadata?: Readonly<Record<string, string>>;
  }): Promise<{ readonly id: string }>;
  /** The orgs a user belongs to — used to reuse an existing personal org (idempotency)
   *  AND, for team orgs (ADR-0068 §3), to check whether a user is already a member
   *  of a given team org before minting a duplicate membership. */
  getOrganizationMembershipList(params: { readonly userId: string }): Promise<{
    readonly data: ReadonlyArray<{
      readonly organization: { readonly id: string; readonly createdAt: number };
    }>;
  }>;
  /** One org by Clerk id, with its `publicMetadata.domain` anchor (null when
   *  the metadata carries none); null when the org doesn't exist. */
  getOrganization(organizationId: string): Promise<{
    readonly id: string;
    readonly name: string;
    readonly domainAnchor: string | null;
  } | null>;
  /** One page of the instance's organizations (`GET /organizations`), for the
   *  bounded anchor scan (ADR-0074). */
  listOrganizations(params: { readonly limit: number; readonly offset: number }): Promise<{
    readonly data: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly domainAnchor: string | null;
    }>;
    readonly totalCount: number;
  }>;
  /** Add a user as a member of an existing org (ADR-0068 §3, JIT team-org join). */
  createOrganizationMembership(params: {
    readonly organizationId: string;
    readonly userId: string;
    readonly role: string;
  }): Promise<{ readonly id: string }>;
}

/** Extract the domain anchor from a raw Clerk org payload's public metadata. */
function anchorOf(publicMetadata: unknown): string | null {
  const anchor = (publicMetadata as Record<string, unknown> | null | undefined)?.domain;
  return typeof anchor === "string" ? anchor : null;
}

export class ClerkBackendOrgProvisioner implements ClerkOrgProvisioner {
  constructor(private readonly orgs: ClerkOrgApi) {}

  /** Build from the Clerk secret key (the composition root passes `CLERK_SECRET_KEY`).
   *
   *  `getOrganization` / `listOrganizations` deliberately go RAW `fetch` against
   *  `api.clerk.com/v1` instead of the SDK: apps/app resolves @clerk/backend v2
   *  at runtime while this package declares v3 (the skew documented on
   *  `isClerkApiError` above), and the organization read/list surface differs
   *  across those majors — a raw call against the stable BAPI wire shape
   *  sidesteps the skew entirely. The narrow `ClerkOrgApi` port keeps the raw
   *  I/O contained. */
  static fromSecretKey(secretKey: string): ClerkBackendOrgProvisioner {
    const client = createClerkClient({ secretKey });
    const bapi = (path: string): Promise<Response> =>
      fetch(`https://api.clerk.com/v1${path}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
    return new ClerkBackendOrgProvisioner({
      createOrganization: (params) => client.organizations.createOrganization(params),
      getOrganizationMembershipList: (params) => client.users.getOrganizationMembershipList(params),
      getOrganization: async (organizationId) => {
        const res = await bapi(`/organizations/${encodeURIComponent(organizationId)}`);
        // 404 = the org is gone — a real answer (verifyOrgAnchor fails closed
        // on it), not an infra failure. Any other non-2xx throws → Unexpected.
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GET /organizations/{id} → ${res.status}`);
        const org = (await res.json()) as {
          id: string;
          name: string;
          public_metadata?: Record<string, unknown>;
        };
        return { id: org.id, name: org.name, domainAnchor: anchorOf(org.public_metadata) };
      },
      listOrganizations: async ({ limit, offset }) => {
        const res = await bapi(`/organizations?limit=${limit}&offset=${offset}`);
        if (!res.ok) throw new Error(`GET /organizations → ${res.status}`);
        const body = (await res.json()) as {
          data: ReadonlyArray<{
            id: string;
            name: string;
            public_metadata?: Record<string, unknown>;
          }>;
          total_count: number;
        };
        return {
          data: body.data.map((o) => ({
            id: o.id,
            name: o.name,
            domainAnchor: anchorOf(o.public_metadata),
          })),
          totalCount: body.total_count,
        };
      },
      createOrganizationMembership: (params) =>
        client.organizations.createOrganizationMembership(params),
    });
  }

  async createPersonalOrg(clerkUserId: string, name: string): Promise<Result<string, AppError>> {
    // Idempotency guard (ADR-0048): reuse the user's existing personal org rather
    // than mint a duplicate on a repeated/SEQUENTIAL first-provision — e.g. a
    // backend-minted e2e session re-run, where each request arrives with no active
    // org. This is check-then-act, so it does NOT close a truly concurrent race
    // (two simultaneous first-uploads can both see an empty list and both create);
    // the old TODO's per-user lock would, but the blast radius is one stray org
    // and creation isn't on a hot concurrent path. Pick the OLDEST org for a
    // stable choice across calls.
    // NOTE: under the 1:1 personal-org model the user has a single membership, so
    // page-1 results suffice and "oldest" is unambiguous; revisit both the paging
    // and the heuristic when ADR-009 cross-org folder grants let a user belong to
    // others' orgs too.
    const existing = await this.findPersonalOrg(clerkUserId);
    // ok + value → reuse it. On a lookup failure (err) favour availability over
    // dedupe and fall through to create: a transient list failure shouldn't block
    // the user from getting an org.
    if (existing.ok && existing.value) return ok(existing.value);

    try {
      const org = await this.orgs.createOrganization({ name, createdBy: clerkUserId });
      return ok(org.id);
    } catch (e) {
      // TODO(abuse): map Clerk 4xx (name validation, 429 rate-limit) to typed
      // AppErrors so they don't all surface as 500 (ADR-0040).
      return err({
        kind: "Unexpected",
        message: `clerk.createOrganization: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async findPersonalOrg(clerkUserId: string): Promise<Result<string | null, AppError>> {
    // Read-only resolution (ADR-0048): the org the write path would reuse, picked
    // as the OLDEST membership for a stable choice. null when the user has none —
    // never creates. A lookup failure is surfaced as Unexpected so the caller can
    // log it (the read path then degrades to an empty list rather than guessing).
    try {
      const memberships = await this.orgs.getOrganizationMembershipList({ userId: clerkUserId });
      const oldest = [...(memberships.data ?? [])].sort(
        (a, b) => a.organization.createdAt - b.organization.createdAt,
      )[0];
      return ok(oldest ? oldest.organization.id : null);
    } catch (e) {
      return err({
        kind: "Unexpected",
        message: `clerk.getOrganizationMembershipList: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async verifyOrgAnchor(clerkOrgId: string, domain: string): Promise<Result<void, AppError>> {
    // TENANT-BOUNDARY GUARD (ADR-0074, descends from review #158 C-1): a
    // DB-index hit names a Clerk org id — before joining anyone into it, prove
    // the org really anchors this domain. Fail CLOSED and loud on ANY
    // discrepancy: a mismatched anchor (index corruption or tampered
    // metadata), a null anchor (every indexed org was created/adopted with the
    // anchor stamped — its absence means drift), or a missing org (deleted in
    // Clerk behind the index's back). Joining on any of these would put a user
    // inside someone else's tenant.
    try {
      const org = await this.orgs.getOrganization(clerkOrgId);
      const expected = domain.toLowerCase();
      if (!org) {
        return err({
          kind: "Unexpected",
          message: `team-org anchor check for domain "${expected}": Clerk org ${clerkOrgId} no longer exists — refusing to join; reconcile the orgs.domain index`,
        });
      }
      if (org.domainAnchor !== expected) {
        return err({
          kind: "Unexpected",
          message: `team-org anchor mismatch for domain "${expected}": Clerk org ${clerkOrgId} anchors ${
            org.domainAnchor === null ? "no domain" : `"${org.domainAnchor}"`
          } — refusing to join; investigate the orgs.domain index`,
        });
      }
      return ok(undefined);
    } catch (e) {
      return err({
        kind: "Unexpected",
        message: `clerk.getOrganization: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async findOrgByAnchorScan(
    domain: string,
  ): Promise<Result<{ clerkOrgId: string; name: string } | null, AppError>> {
    // ADOPTION path (ADR-0074), used ONLY on a DB-index miss: an org for this
    // domain may exist in Clerk without a DB row (created before the index
    // existed — the House Numbers shape). Clerk offers no metadata query
    // parameter on the free plan, so scan the org list client-side, bounded to
    // ANCHOR_SCAN_MAX_ORGS. Only an EXACT anchor match adopts — a null-anchor
    // org is never matched (nothing proves it belongs to this domain).
    try {
      const expected = domain.toLowerCase();
      for (let offset = 0; offset < ANCHOR_SCAN_MAX_ORGS; offset += ANCHOR_SCAN_PAGE_SIZE) {
        const page = await this.orgs.listOrganizations({ limit: ANCHOR_SCAN_PAGE_SIZE, offset });
        const match = page.data.find((o) => o.domainAnchor === expected);
        if (match) return ok({ clerkOrgId: match.id, name: match.name });
        const exhausted =
          page.data.length < ANCHOR_SCAN_PAGE_SIZE || offset + page.data.length >= page.totalCount;
        if (exhausted) return ok(null); // ran out of orgs before the bound
      }
      return ok(null); // scan bound reached — treat as no adoptable org
    } catch (e) {
      return err({
        kind: "Unexpected",
        message: `clerk.listOrganizations: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async createTeamOrg(domain: string, createdBy: string): Promise<Result<string, AppError>> {
    // ADR-0068 §3 / ADR-0074: the FIRST sign-up at a corporate domain creates
    // its team org. `name` is the (lowercased) domain itself — there's no other
    // display name to draw from at JIT time. NO slug is sent: the prod
    // instance auto-generates slugs (slug_disabled) and nothing keys on them
    // anymore — the DB domain index is the lookup, `publicMetadata.domain` the
    // identity anchor. Uniqueness/racing is NOT handled here: the caller
    // records the org row against the partial unique index and joins the
    // winner on Conflict.
    try {
      const normalized = domain.toLowerCase();
      const org = await this.orgs.createOrganization({
        name: normalized,
        createdBy,
        // The identity anchor verifyOrgAnchor checks before any index-driven
        // join (review #158 C-1) — metadata, not `name`, because name is a
        // mutable display string.
        publicMetadata: { domain: normalized },
      });
      return ok(org.id);
    } catch (e) {
      return err({
        kind: "Unexpected",
        message: `clerk.createOrganization(team): ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async ensureMembership(clerkOrgId: string, clerkUserId: string): Promise<Result<void, AppError>> {
    // Idempotent, concurrency-tolerant join (ADR-0068 §3): check-then-act, same
    // accepted trade-off as createPersonalOrg's dedupe guard (a truly concurrent
    // double-join attempt can race — Clerk itself rejects the duplicate, and we
    // treat that as success too, below). Reuses the SAME membership-list lookup
    // findPersonalOrg/createPersonalOrg already depend on (client.users.
    // getOrganizationMembershipList) rather than a new Clerk endpoint.
    try {
      const memberships = await this.orgs.getOrganizationMembershipList({ userId: clerkUserId });
      const alreadyMember = (memberships.data ?? []).some((m) => m.organization.id === clerkOrgId);
      if (alreadyMember) return ok(undefined);

      await this.orgs.createOrganizationMembership({
        organizationId: clerkOrgId,
        userId: clerkUserId,
        role: TEAM_MEMBER_ROLE,
      });
      return ok(undefined);
    } catch (e) {
      // A concurrent duplicate-join is the ONLY error treated as idempotent
      // success — matched by Clerk's specific error code, NOT the bare 422
      // status (review #158 H-2: 422 also covers quota-exceeded, invalid role,
      // etc., and swallowing those would mirror an identity against an org the
      // user never actually joined).
      if (
        isClerkApiError(e) &&
        e.errors.some((detail) => detail.code === "already_a_member_in_organization")
      ) {
        return ok(undefined);
      }
      // The org's membership cap (free plan: the instance default, raised to
      // 20) — typed so the webhook acks it with an alert instead of retrying
      // (ADR-0074: Svix retries can't fix a plan cap).
      if (isClerkApiError(e) && e.errors.some((detail) => isMemberCapCode(detail.code))) {
        return err({
          kind: "PlanLimitExceeded",
          message: `clerk org ${clerkOrgId} is at its membership cap: ${e.message}`,
        });
      }
      return err({
        kind: "Unexpected",
        message: `clerk.createOrganizationMembership: ${
          e instanceof Error || isClerkApiError(e) ? e.message : String(e)
        }`,
      });
    }
  }
}
