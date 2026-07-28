// The `handle()` combinator — the ONE write (and read) front door for every
// /api/v1 route. It owns the choreography each route used to hand-inline:
// dispatch the method (`methods()`) → resolve the actor (read|write mode, via
// the four-door resolve-actor seam) → optionally resolve a `report_`/slug path
// param → optionally parse the JSON body → parse the cross-cutting write
// context (Idempotency-Key per ADR-0039, audit attribution per ADR-0070) → run
// the caller's use-case callback → map its Result to a wire response →
// serialize via toResponse (+ Request-Id). Each route shrinks to declaring its
// intent: which verbs, which actor mode, which slug/body extraction, which
// container-wired op (`ops()` in container.server.ts), and how to map success.
//
// The actor/slug resolvers are injected (defaulting to the real Clerk-backed
// ones) so the choreography itself is unit-testable without a real session or
// database — see handle.server.test.ts, which also proves the ADR-0039 wire
// semantics (replay / in-flight 409 / key-reuse 422) through this seam.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { ReportRepository, UploadActor } from "arp-application";
import type { AppError, OrgId, Result, Slug, UserId } from "arp-domain";
import { methodNotAllowed } from "arp-domain";
import { errorToHttp, type HttpResponse, parseJsonBody } from "arp-http";
import { resolveActorForRead, resolveUploadActor } from "./auth.server";
import { deps } from "./container.server";
import { toResponse, unauthenticated } from "./http.server";
import { resolveReportSlug } from "./report-handle.server";

/** The read-path actor shape (no write-only fields like `folderId`). `scopes`
 *  IS carried (ADR-0060 §3) so a read-only, owner-gated use case
 *  (`listWriteGrants`) can still enforce the `acl:write` scope on a GET. */
export type ReadActor = Pick<UploadActor, "userId" | "orgId" | "scopes">;

/** The resolvers `handle()` depends on — injected so tests can fake them. */
export interface HandleDeps {
  readonly resolveActorForRead: (
    args: LoaderFunctionArgs,
  ) => Promise<Result<ReadActor | null, AppError>>;
  readonly resolveUploadActor: (args: LoaderFunctionArgs) => Promise<Result<UploadActor, AppError>>;
  readonly resolveReportSlug: (
    handle: string,
    reports: ReportRepository,
  ) => Promise<Result<Slug, AppError>>;
  /** Thunked (like the container's own accessors) so it's read lazily per call. */
  readonly reports: () => ReportRepository;
}

const liveHandleDeps: HandleDeps = {
  resolveActorForRead,
  resolveUploadActor,
  resolveReportSlug,
  reports: () => deps().reports,
};

/** ADR-0070 audit attribution for the resolved write actor — the pair every
 *  audited use case stamps on its `audit_log` row. Parsed once by the seam;
 *  the planned ipHash/geo enrichment (ADR-0070 §3 follow-up) will hang here. */
export interface WriteAuditContext {
  readonly orgId: OrgId;
  readonly actorUserId: UserId;
}

// `HasSlug`/`HasBody` are boolean literal type params TS infers from the
// `slug`/`parseBody` option flags, so `ctx.slug`/`ctx.body` are typed as
// REQUIRED (not `Slug | undefined`) whenever the route asked for them —
// no non-null assertions needed at the call site.
export interface ReadRunContext<HasSlug extends boolean = false> {
  readonly args: LoaderFunctionArgs;
  readonly actor: ReadActor;
  readonly slug: HasSlug extends true ? Slug : Slug | undefined;
  /** The request URL, parsed once — for query/cursor params. */
  readonly url: URL;
}

export interface WriteRunContext<HasSlug extends boolean = false, HasBody extends boolean = false> {
  readonly args: ActionFunctionArgs;
  readonly actor: UploadActor;
  readonly slug: HasSlug extends true ? Slug : Slug | undefined;
  readonly body: HasBody extends true
    ? Record<string, unknown>
    : Record<string, unknown> | undefined;
  /** The request URL, parsed once — for query/cursor params. */
  readonly url: URL;
  /** The client's `Idempotency-Key` header (ADR-0039), trimmed; undefined when
   *  absent/blank. Every mutating op accepts it as `input.idempotencyKey`. */
  readonly idempotencyKey: string | undefined;
  /** ADR-0070 audit attribution for the resolved actor. */
  readonly audit: WriteAuditContext;
}

/** A use-case callback may resolve synchronously (a validation guard returning
 *  `err(...)` directly) or asynchronously (the real use-case call) — `handle()`
 *  awaits either. */
type MaybePromise<T> = T | Promise<T>;

interface HandleReadOptions<T, HasSlug extends boolean = false> {
  readonly mode: "read";
  /** Resolve `args.params.slug` (a `report_` id or a bare slug) into ctx.slug. */
  readonly slug?: HasSlug;
  readonly run: (ctx: ReadRunContext<HasSlug>) => MaybePromise<Result<T, AppError>>;
  readonly toHttp: (result: Result<T, AppError>, ctx: ReadRunContext<HasSlug>) => HttpResponse;
}

interface HandleWriteOptions<T, HasSlug extends boolean = false, HasBody extends boolean = false> {
  readonly mode: "write";
  readonly slug?: HasSlug;
  /** Parse `args.request` as a JSON object into ctx.body (415/422 on failure). */
  readonly parseBody?: HasBody;
  readonly run: (ctx: WriteRunContext<HasSlug, HasBody>) => MaybePromise<Result<T, AppError>>;
  readonly toHttp: (
    result: Result<T, AppError>,
    ctx: WriteRunContext<HasSlug, HasBody>,
  ) => HttpResponse;
}

export type HandleOptions<T> =
  | HandleReadOptions<T, boolean>
  | HandleWriteOptions<T, boolean, boolean>;

export function handle<T, HasSlug extends boolean = false>(
  options: HandleReadOptions<T, HasSlug>,
  overrides?: Partial<HandleDeps>,
): (args: LoaderFunctionArgs) => Promise<Response>;
export function handle<T, HasSlug extends boolean = false, HasBody extends boolean = false>(
  options: HandleWriteOptions<T, HasSlug, HasBody>,
  overrides?: Partial<HandleDeps>,
): (args: ActionFunctionArgs) => Promise<Response>;
export function handle<T>(
  options: HandleOptions<T>,
  overrides?: Partial<HandleDeps>,
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<Response> {
  const d: HandleDeps = { ...liveHandleDeps, ...overrides };

  if (options.mode === "read") {
    return async (args: LoaderFunctionArgs) => {
      const actorResult = await d.resolveActorForRead(args);
      if (!actorResult.ok) return toResponse(errorToHttp(actorResult.error)); // infra failure → 500
      if (!actorResult.value) return toResponse(unauthenticated()); // no session / no org → 401
      const actor = actorResult.value;

      const slug = options.slug ? await resolveSlug(d, args.params.slug) : undefined;
      if (slug && !slug.ok) return toResponse(errorToHttp(slug.error));

      const ctx: ReadRunContext<boolean> = {
        args,
        actor,
        slug: slug?.value,
        url: new URL(args.request.url),
      };
      const result = await options.run(ctx);
      return toResponse(options.toHttp(result, ctx));
    };
  }

  return async (args: ActionFunctionArgs) => {
    const actorResult = await d.resolveUploadActor(args);
    if (!actorResult.ok) return toResponse(errorToHttp(actorResult.error)); // 401 / 500 per kind
    const actor = actorResult.value;

    const slug = options.slug ? await resolveSlug(d, args.params.slug) : undefined;
    if (slug && !slug.ok) return toResponse(errorToHttp(slug.error));

    let body: Record<string, unknown> | undefined;
    if (options.parseBody) {
      const bodyResult = await parseJsonBody(args.request);
      if (!bodyResult.ok) return toResponse(errorToHttp(bodyResult.error));
      body = bodyResult.value;
    }

    const ctx: WriteRunContext<boolean, boolean> = {
      args,
      actor,
      slug: slug?.value,
      body,
      url: new URL(args.request.url),
      idempotencyKey: idempotencyKeyOf(args.request),
      audit: { orgId: actor.orgId, actorUserId: actor.userId },
    };
    const result = await options.run(ctx);
    return toResponse(options.toHttp(result, ctx));
  };
}

/** The client's `Idempotency-Key` header (ADR-0039), trimmed → undefined when
 *  absent or blank. Parsed here once so no route hand-reads the header. */
function idempotencyKeyOf(request: Request): string | undefined {
  const raw = request.headers.get("Idempotency-Key")?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

type ActionMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The shared action dispatcher — collapses the hand-written `if (method !==
 * …) return 405` switches every route repeated. Verbs without a handler get
 * the canonical 405 problem advertising the allowed set, and auth never runs
 * for them (the 405 is decided before any handler executes).
 */
export function methods(
  handlers: Partial<Record<ActionMethod, (args: ActionFunctionArgs) => Promise<Response>>>,
): (args: ActionFunctionArgs) => Promise<Response> {
  const allowed = Object.keys(handlers).join(", ");
  return async (args: ActionFunctionArgs) => {
    const handler = handlers[args.request.method.toUpperCase() as ActionMethod];
    if (!handler) return toResponse(errorToHttp(methodNotAllowed(allowed)));
    return handler(args);
  };
}

/**
 * A loader that only ever 405s — for action-only resources that still need a
 * `loader` export (React-Router routes any OPTIONS/GET to `loader`, never
 * `action`; CORS-wrapped resources need the loader to exist so `corsRoute` can
 * answer the OPTIONS preflight, and a stray GET should read as 405, not 404).
 */
export function methodNotAllowedLoader(
  allow: string,
): (args: LoaderFunctionArgs) => Promise<Response> {
  return async () => toResponse(errorToHttp(methodNotAllowed(allow)));
}

async function resolveSlug(
  d: HandleDeps,
  raw: string | undefined,
): Promise<Result<Slug, AppError>> {
  return d.resolveReportSlug(String(raw ?? ""), d.reports());
}
