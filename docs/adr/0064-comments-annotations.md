# ADR-0064: Comments & annotations

- **Status**: Accepted
- **Date**: 2026-07-07
- **Deciders**: agranado2k
- **Relates to / amends**: ADR-0036 (DDD — introduces a new bounded context), ADR-0059/ADR-0060 (owner + write-grant authorization — comment write ops gate on `canWrite`), ADR-0062 (ProseMirror editing model — anchors are positions in that document model), ADR-0063 (in-viewer editing — comments surface on the same authenticated edit route), ADR-0038 (viewer access & serving — the public route continues to serve zero collaboration data), ADR-020 (repository pattern), ADR-024 (functional/immutable domain layer), ADR-0053 (wire conventions — comment CRUD follows the existing envelope).

## Context and problem statement

The editing epic (ADR-0062/0063) adds an authenticated in-viewer editing surface. The natural next step is letting collaborators discuss specific parts of a report without changing its content directly: comments anchored to a location in the document, threaded one level deep, resolvable. This is new domain behavior — it doesn't fit inside Reports & Folders' existing aggregates (`Report`, `Folder`), and it isn't a variant of an existing write path — so it needs its own modeling home, its own authorization answer (does read-only access allow commenting?), and its own anchoring strategy that survives the document being edited out from under a comment.

## Decision drivers

- Model comments where they belong per ADR-0036's DDD discipline, rather than bolting them onto the `Report` aggregate.
- Anchors must survive normal editing — an anchor that breaks the moment the document changes is not useful for a live editing surface.
- Reuse the `canWrite` seam (ADR-0059/0060) rather than inventing a third authorization axis.
- Comments are workspace collaboration data, not published content — the public viewer's zero-trust posture (ADR-0038) must not leak any of it.
- Keep the domain layer pure (ADR-024) and the storage/repository pattern consistent with existing aggregates (ADR-020).

## Decision outcome

### 1. New bounded context: Authoring & Collaboration

Comments and annotation anchors are modeled in a **new bounded context, Authoring & Collaboration**, alongside Reports & Folders / Identity & Access / Abuse & Moderation (ADR-0036). This context owns the `Comment` aggregate now; ADR-0066 (not yet written) will add a `Suggestion` aggregate to the same context later — the editing epic's suggestion-mode feature is deliberately out of scope here. Authoring & Collaboration integrates with Reports & Folders through **domain events** only (`CommentAdded`, `CommentResolved` — see Decision 6); the only shared kernel types remain `UserId` and `OrgId`, unchanged by this ADR. **The `docs/context-map.md` and `docs/domain-glossary.md` updates for this new context are a requirement of the same PR's integration step — they are not made by this ADR itself**, consistent with how ADR-0059/0060 handled their own glossary entries.

### 2. `Comment` aggregate

Root entity, fields: `id`, `reportId`, `authorUserId`, `body` (bounded length — a comment is a short annotation, not a document), `anchor` (see Decision 2a), a `resolved`/`open` state, and timestamps (`createdAt`, `resolvedAt` nullable). A thread is a root comment plus its replies, **single level** — replies cannot themselves be replied to. This mirrors the product need (discuss one point, then resolve) without building general-purpose nested threading.

**Anchoring (2a).** Two-part, degrading gracefully:

- **Primary: a relative position into the ProseMirror document** (ADR-0062's model) — stable across ordinary edits (insertions/deletions elsewhere in the doc don't invalidate it), and deliberately chosen to be **Yjs-relative-position-compatible** so it composes with a future real-time collaboration transport (ADR-0067, not yet written) without a re-anchoring migration.
- **Fallback: a version-pinned snapshot** — `versionId` (the `ReportVersion` the comment was created against) plus a text-quote snapshot of the anchored content. When an edit is heavy enough that the relative position can no longer be resolved in the current document, the anchor **degrades to "attached to version N"** (surfaced in the UI as pinned to that version) rather than being silently dropped or pointing at the wrong location. A comment is never lost to an edit; at worst it stops floating with live content.

### 3. Authorization: comments require `canWrite`, not just read access

Creating, editing, or resolving a comment requires authentication **and** report access, gated the same way report writes are: `canWrite(report, actor) = isOwner OR hasWriteGrant` (ADR-0059/0060). This was an explicit fork in this ADR — **can a read-only viewer comment?**

**Decision: no, not in v1.** Commenting requires `canWrite`. Rationale: comments in this epic exist to steer content changes on a report someone can already edit — the collaboration surface is the edit route (ADR-0063), and read-only sharing (ADR-0056's `password`/`org`/`allowlist` view modes) is a content-consumption grant, not a collaboration grant. Read-only commenting (a lighter-weight "suggest via comment without write access" mode) is a **considered, deferred** option — noted here so it isn't rediscovered as a surprise later, but it is out of scope for this ADR.

Resolving/deleting a comment: the comment's **author** or the report's **owner** may resolve or delete it. The owner can additionally moderate (resolve/delete) any comment on their report, matching the existing owner-is-final-authority pattern from ADR-0059 (owner-only delete/set_acl/grant-management).

### 4. No anonymous read of comments, either

The public route (`GET /<slug>`, unchanged by ADR-0063 Decision 2) serves **zero** comment data — comments are workspace collaboration data, not published content, and leaking them would leak internal discussion to anyone holding the public capability slug. Comments surface only on authenticated surfaces: the dashboard (`app.<domain>`) and the viewer's authenticated edit route (`GET /<slug>/edit`, ADR-0063). There is no comment-reading code path reachable from the public viewer route.

### 5. Storage

A new `comments` table (Drizzle, `packages/db`), sketch columns: `id uuid PK`, `report_id uuid FK → reports ON DELETE CASCADE`, `author_user_id uuid FK → users`, `parent_comment_id uuid FK → comments NULL` (NULL = root; single level enforced at the application layer, not a self-join depth constraint), `body text`, `anchor_json jsonb` (the relative-position + version-pinned-fallback shape from Decision 2a), `resolved_at timestamptz NULL`, `created_at timestamptz`. Access via the **repository pattern** (ADR-020) — a `CommentRepository` interface in `packages/application`, a Drizzle implementation in `packages/adapters`, one repository per aggregate root as established for `Report`/`Folder`. The `Comment` domain type itself is pure — `readonly` fields, no I/O, all persistence pushed to the adapter (ADR-024).

### 6. Events

Two new domain events, added to `docs/events.md` in the same PR (the integration step, not this ADR): `CommentAdded` (emitted on comment creation, consumed by Reports & Folders for... nothing directly — reserved for future notification/audit fan-out — and by AuditLogger) and `CommentResolved` (emitted on resolve, consumed by AuditLogger). Both emitted at the `Comment` aggregate boundary (ADR-0036's domain-events discipline) and delivered via the existing transactional outbox, matching every other event in the catalog — no new transport is introduced for this context.

### 7. API

Comment CRUD lives under `/api/v1/reports/{slug}/comments` (list/create) and `/api/v1/reports/{slug}/comments/{comment_id}` (get/update/resolve/delete), auth-required on every route, following the existing wire conventions (ADR-0053: flat snake_case resources, list envelope, cursor pagination for the list endpoint, RFC-9457 errors per ADR-0040). The full `openapi.yaml` addition and Bruno regen happen in the implementation PR, per the doc-trigger matrix (ADR-026) — noted here as a requirement, not performed by this ADR.

## Considered options

- **New bounded context (Authoring & Collaboration)** *(chosen)* vs. modeling `Comment` as a member of the `Report` aggregate (rejected — comments have their own lifecycle, authorship, and moderation concerns distinct from report content/versioning, and bolting them onto `Report` would force every report read to consider loading comment threads).
- **Anchoring**: relative-position primary + version-pinned fallback *(chosen)* vs. version-pinned only (rejected — every edit would orphan every comment, useless for a live editing surface) vs. relative-position only with no fallback (rejected — a heavily-edited document can make a position genuinely unresolvable; silently dropping the comment loses user data).
- **Read-only commenting**: excluded from v1, `canWrite`-gated only *(chosen)* vs. allow read-only viewers to comment (deferred — a real product option, but conflates the view-access grant with a collaboration grant; revisit if a concrete need surfaces).
- **Threading depth**: single level (root + replies) *(chosen)* vs. arbitrary nesting (rejected — unneeded complexity for a v1 discuss-and-resolve workflow).

## Consequences

**Positive**

- Comments get a clean domain home with its own aggregate, matching the DDD discipline the rest of the codebase already follows.
- The anchor design is forward-compatible with the eventual Yjs-based real-time collaboration transport (ADR-0067), avoiding a re-anchoring migration later.
- Reusing `canWrite` means no new authorization primitive, and revoking a write grant immediately stops that user's ability to comment, consistent with how it stops their ability to edit.
- The public viewer's zero-trust posture is unaffected — comments are invisible to anyone without report write access.

**Negative / trade-offs**

- Read-only viewers cannot comment in v1, which may be a UX gap for report reviewers without edit rights — explicitly deferred rather than solved here.
- Single-level threading means a genuinely deep discussion has nowhere to go but a longer flat reply list; acceptable for v1, revisit if it becomes a real complaint.
- Every comment mutation (create, resolve, delete) gets an `audit_log` row, matching the existing every-mutation-audited pattern (ADR-0059/0060 write paths, ADR-0056 ACL changes) — this is additional write amplification per comment action, judged acceptable given comment volume is expected to be far lower than report reads.
- The version-pinned fallback means a comment can end up "attached to version N" rather than live-floating — a real UX state the dashboard/editor must render distinctly from a normally-anchored comment.

## More information

- Implementation: `Comment` in `packages/domain`; `CommentRepository` port in `packages/application` + Drizzle adapter in `packages/adapters` (ADR-020, ADR-0046 test tiers apply — pglite fixtures need a `comments` table); `addComment`/`resolveComment`/`deleteComment` use cases enforcing `canWrite` and the author-or-owner resolve/delete rule; the anchor codec (relative-position ⇄ version-pinned fallback) likely lives alongside the ADR-0062 ProseMirror schema code, since it needs the document model to resolve positions.
- `docs/context-map.md` gains the Authoring & Collaboration context box and its event edges to Reports & Folders; `docs/domain-glossary.md` gains **Comment**, **Anchor**, **Thread** (and marks read-only commenting as an explicitly deferred non-term) — both in this PR's integration step, not by this ADR file itself.
- `docs/events.md` gains `CommentAdded` / `CommentResolved` rows in the same PR.
- ADR-0066 (Suggestion mode, not yet written) will extend this context; ADR-0067 (real-time collaboration transport, not yet written) is the reason the anchor is Yjs-relative-position-compatible now rather than later.
