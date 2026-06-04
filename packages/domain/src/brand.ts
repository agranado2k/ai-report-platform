// Branded primitive types for entity ids (ADR-0036 value objects). A Brand is a
// nominal type over a primitive — a UserId is never accidentally a ReportId.
// Ids originate as UUIDv7 strings upstream; these constructors only tag them.

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrgId = Brand<string, 'OrgId'>;
export type UserId = Brand<string, 'UserId'>;
export type FolderId = Brand<string, 'FolderId'>;
export type ReportId = Brand<string, 'ReportId'>;
export type VersionId = Brand<string, 'VersionId'>;

export const orgId = (s: string): OrgId => s as OrgId;
export const userId = (s: string): UserId => s as UserId;
export const folderId = (s: string): FolderId => s as FolderId;
export const reportId = (s: string): ReportId => s as ReportId;
export const versionId = (s: string): VersionId => s as VersionId;
