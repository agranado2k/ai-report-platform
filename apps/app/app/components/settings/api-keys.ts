// Pure view-model helpers for the Settings → API keys section (#338, report §04).
// No React, no Remix, no DOM: the scope catalogue, the created-key narrowing,
// action-error extraction, key status and date formatting are plain functions so
// the presentational islands stay thin wrappers and the branchy bits are unit-
// tested here. This is presentation only — key issuance, scope validation and
// revocation stay in the use cases (createApiKey re-validates every selection
// against KEY_ISSUABLE_SCOPES server-side).

export type ScopeId = "reports:write" | "acl:write";

export type ScopeCard = {
  readonly id: ScopeId;
  readonly title: string;
  readonly description: string;
  readonly defaultChecked: boolean;
};

// The two KEY_ISSUABLE_SCOPES (ADR-0016) as display metadata. NOT imported from
// arp-domain: this ships to the browser and the domain barrel pulls node:crypto
// (signed-token) into the client bundle. Tamper-safety doesn't live here — the
// create use case re-validates the selection server-side.
export const SCOPE_CARDS: readonly ScopeCard[] = [
  {
    id: "reports:write",
    title: "reports:write",
    description: "Upload and update reports, create folders, resolve comments",
    defaultChecked: true,
  },
  {
    id: "acl:write",
    title: "acl:write",
    description: "Change sharing and grant write access. Only for automation you trust.",
    defaultChecked: false,
  },
];

export type CreatedKey = {
  readonly secret: string;
  readonly name: string;
  readonly scopes: readonly string[];
};

// The create-success branch of useActionData is the only shape carrying a
// non-null `secret`; revoke success, an error, an ADR-0039 explicit-key replay
// (secret present but null — never re-displayed) and `undefined` all narrow to
// null, so no secret box renders.
export function createdKeyView(data: unknown): CreatedKey | null {
  if (!data || typeof data !== "object" || !("secret" in data)) return null;
  const d = data as { secret?: unknown; name?: unknown; scopes?: unknown };
  if (typeof d.secret !== "string" || d.secret.length === 0) return null;
  return {
    secret: d.secret,
    name: typeof d.name === "string" ? d.name : "",
    scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
  };
}

// A create/revoke failure serialises as `{ error: string }` (errorToJson). Blank
// or absent → null (nothing to announce).
export function actionError(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const e = (data as { error?: unknown }).error;
  return typeof e === "string" && e.length > 0 ? e : null;
}

export function keyStatus(revokedAt: number | null | undefined): "active" | "revoked" {
  return revokedAt ? "revoked" : "active";
}

// A present timestamp renders as a locale date; a missing one (a key never used)
// renders an em dash — the §04 table's "Last used" empty state.
export function formatKeyDate(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleDateString() : "—";
}
