// Branded primitive types for entity ids (ADR-0036 value objects). A Brand is a
// nominal type over a primitive — a UserId is never accidentally a ReportId.
// OUR ids are UUIDv7 strings internally; on the wire they're `<prefix>_<base62>`
// External Ids (ADR-0052). These constructors only tag a trusted internal value;
// untrusted client input goes through the validating `make*Id` smart constructors.

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// Our own entity ids (UUIDv7 PKs).
export type OrgId = Brand<string, "OrgId">;
export type UserId = Brand<string, "UserId">;
export type FolderId = Brand<string, "FolderId">;
export type ReportId = Brand<string, "ReportId">;
export type VersionId = Brand<string, "VersionId">;

// Third-party (Clerk) ids — segregated from OUR ids (ADR-0052). Persisted in the
// `clerk_user_id` / `clerk_org_id` columns; used only to map a Clerk principal to
// our mirrored User/Org. NEVER serialized on the wire.
export type ClerkUserId = Brand<string, "ClerkUserId">;
export type ClerkOrgId = Brand<string, "ClerkOrgId">;

export const orgId = (s: string): OrgId => s as OrgId;
export const userId = (s: string): UserId => s as UserId;
export const folderId = (s: string): FolderId => s as FolderId;
export const reportId = (s: string): ReportId => s as ReportId;
export const versionId = (s: string): VersionId => s as VersionId;
export const clerkUserId = (s: string): ClerkUserId => s as ClerkUserId;
export const clerkOrgId = (s: string): ClerkOrgId => s as ClerkOrgId;
