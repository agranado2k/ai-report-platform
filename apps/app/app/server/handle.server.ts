// The `handle()` combinator (route-seam deepening) — owns the choreography every
// /api/v1 route used to hand-inline: resolve the actor (read|write mode) →
// optionally resolve a `report_`/slug path param → optionally parse the JSON
// body → run the caller's use-case callback → map its Result to a wire response
// → serialize via toResponse (+ Request-Id). Each route shrinks to declaring its
// intent: which actor mode, which slug/body extraction, which use case, and how
// to map success to a response.
//
// The actor/slug resolvers are injected (defaulting to the real Clerk-backed
// ones) so the choreography itself is unit-testable without a real session or
// database — see handle.server.test.ts.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { ReportRepository, UploadActor } from "arp-application";
import type { AppError, Result, Slug } from "arp-domain";
import { errorToHttp, type HttpResponse, parseJsonBody } from "arp-http";
import { resolveActorForRead, resolveUploadActor } from "./auth.server";
import { deps } from "./container.server";
import { toResponse, unauthenticated } from "./http.server";
import { resolveReportSlug } from "./report-handle.server";

/** The read-path actor shape (no write-only fields like `folderId`/`scopes`). */
export type ReadActor = Pick<UploadActor, "userId" | "orgId">;

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

// `HasSlug`/`HasBody` are boolean literal type params TS infers from the
// `slug`/`parseBody` option flags, so `ctx.slug`/`ctx.body` are typed as
// REQUIRED (not `Slug | undefined`) whenever the route asked for them —
// no non-null assertions needed at the call site.
export interface ReadRunContext<HasSlug extends boolean = false> {
  readonly args: LoaderFunctionArgs;
  readonly actor: ReadActor;
  readonly slug: HasSlug extends true ? Slug : Slug | undefined;
}

export interface WriteRunContext<HasSlug extends boolean = false, HasBody extends boolean = false> {
  readonly args: ActionFunctionArgs;
  readonly actor: UploadActor;
  readonly slug: HasSlug extends true ? Slug : Slug | undefined;
  readonly body: HasBody extends true
    ? Record<string, unknown>
    : Record<string, unknown> | undefined;
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

      const ctx: ReadRunContext<boolean> = { args, actor, slug: slug?.value };
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

    const ctx: WriteRunContext<boolean, boolean> = { args, actor, slug: slug?.value, body };
    const result = await options.run(ctx);
    return toResponse(options.toHttp(result, ctx));
  };
}

async function resolveSlug(
  d: HandleDeps,
  raw: string | undefined,
): Promise<Result<Slug, AppError>> {
  return d.resolveReportSlug(String(raw ?? ""), d.reports());
}
