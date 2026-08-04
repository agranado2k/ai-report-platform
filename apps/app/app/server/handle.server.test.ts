// Unit tests for the `handle()` combinator (route-seam deepening). Every
// /api/v1 route hand-inlined the same actor-resolution → slug-resolution →
// body-parse → run-use-case → map-Result → toResponse choreography; these
// tests exercise that choreography in isolation, with FAKE actor/slug
// resolvers injected — no real Clerk session or DB is needed.
import type { ReportRepository, UploadActor } from "arp-application";
import { err, folderId, ok, orgId, userId, validationError } from "arp-domain";
import { errorToHttp } from "arp-http";
import { describe, expect, it, vi } from "vitest";
import {
  handle,
  methodNotAllowedLoader,
  methods,
  type ReadActor,
  type ReadRunContext,
  type WriteRunContext,
} from "./handle.server";

/** A stub `ReportRepository` — tests that fake `resolveReportSlug` never touch
 *  it, but `handle()` still passes it through, so it must not require the real
 *  env-backed container (which throws outside a fully-configured environment). */
const stubReports = () => ({}) as ReportRepository;

const anOrgId = orgId("00000000-0000-7000-8000-0000000000a1");
const aUserId = userId("00000000-0000-7000-8000-0000000000u1");
const aFolderId = folderId("00000000-0000-7000-8000-0000000000f1");

const readActor: ReadActor = { userId: aUserId, orgId: anOrgId, scopes: ["reports:read"] };
const writeActor: UploadActor = {
  userId: aUserId,
  orgId: anOrgId,
  folderId: aFolderId,
  scopes: ["reports:write"],
};

function req(url = "https://app.example.test/", init?: RequestInit): Request {
  return new Request(url, init);
}

describe("handle() — read mode", () => {
  it("returns 500 when actor resolution fails (infra error)", async () => {
    const run = vi.fn();
    const action = handle(
      {
        mode: "read",
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveActorForRead: async () => err({ kind: "Unexpected", message: "db down" }) },
    );

    const res = await action({ request: req(), params: {}, context: {} });
    expect(res.status).toBe(500);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 401 when there's no actor (no session)", async () => {
    const run = vi.fn();
    const action = handle(
      {
        mode: "read",
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveActorForRead: async () => ok(null) },
    );

    const res = await action({ request: req(), params: {}, context: {} });
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("resolves the slug and threads it into run(), then maps the result via toHttp", async () => {
    const run = vi.fn(async (_ctx: ReadRunContext<true>) => ok({ title: "hello" }));
    const toHttp = vi.fn(() => ({
      status: 200,
      contentType: "application/json" as const,
      body: { ok: true },
    }));
    const action = handle(
      { mode: "read", slug: true, run, toHttp },
      {
        resolveActorForRead: async () => ok(readActor),
        resolveReportSlug: async () => ok("abc1234567" as never),
        reports: stubReports,
      },
    );

    const res = await action({ request: req(), params: { slug: "abc1234567" }, context: {} });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    const ctx = run.mock.calls[0]?.[0];
    if (!ctx) throw new Error("run was not called");
    expect(ctx.actor).toEqual(readActor);
    expect(ctx.slug).toBe("abc1234567");
    expect(toHttp).toHaveBeenCalledWith(await run.mock.results[0]?.value, ctx);
  });

  it("short-circuits to a problem response when slug resolution fails", async () => {
    const run = vi.fn();
    const action = handle(
      {
        mode: "read",
        slug: true,
        run,
        toHttp: () => ({ status: 200, contentType: "x", body: {} }),
      },
      {
        resolveActorForRead: async () => ok(readActor),
        resolveReportSlug: async () => err(validationError("bad slug")),
        reports: stubReports,
      },
    );

    const res = await action({ request: req(), params: { slug: "??" }, context: {} });
    expect(res.status).toBe(422);
    expect(run).not.toHaveBeenCalled();
  });

  it("sets the Request-Id header on every response (goes through toResponse)", async () => {
    const action = handle(
      {
        mode: "read",
        run: async () => ok(1),
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveActorForRead: async () => ok(readActor) },
    );
    const res = await action({ request: req(), params: {}, context: {} });
    expect(res.headers.get("Request-Id")).toMatch(/^req_/);
  });
});

describe("handle() — write mode", () => {
  it("returns the actor's error status when resolveUploadActor fails", async () => {
    const run = vi.fn();
    const action = handle(
      {
        mode: "write",
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: async () => err({ kind: "Unauthenticated", message: "no session" }) },
    );

    const res = await action({ request: req(), params: {}, context: {} });
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("parses the JSON body and threads it into run()", async () => {
    const run = vi.fn(async (_ctx: WriteRunContext<false, true>) => ok({ done: true }));
    const action = handle(
      {
        mode: "write",
        parseBody: true,
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: async () => ok(writeActor) },
    );

    const res = await action({
      request: req("https://app.example.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
      params: {},
      context: {},
    });
    expect(res.status).toBe(200);
    const ctx = run.mock.calls[0]?.[0];
    if (!ctx) throw new Error("run was not called");
    expect(ctx.body).toEqual({ name: "x" });
    expect(ctx.actor).toEqual(writeActor);
  });

  it("short-circuits to a problem response when the body is malformed", async () => {
    const run = vi.fn();
    const action = handle(
      {
        mode: "write",
        parseBody: true,
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: async () => ok(writeActor) },
    );

    const res = await action({
      request: req("https://app.example.test/", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "nope",
      }),
      params: {},
      context: {},
    });
    expect(res.status).toBe(415);
    expect(run).not.toHaveBeenCalled();
  });

  it("resolves the slug on the write path too", async () => {
    const run = vi.fn(async (_ctx: WriteRunContext<true, false>) => ok(1));
    const action = handle(
      {
        mode: "write",
        slug: true,
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      {
        resolveUploadActor: async () => ok(writeActor),
        resolveReportSlug: async () => ok("zzz9999999" as never),
        reports: stubReports,
      },
    );

    const res = await action({ request: req(), params: { slug: "zzz9999999" }, context: {} });
    expect(res.status).toBe(200);
    expect(run.mock.calls[0]?.[0].slug).toBe("zzz9999999");
  });
});

describe("handle() — result type", () => {
  it("returns a real Fetch Response", async () => {
    const action = handle(
      {
        mode: "read",
        run: async () => ok(1),
        toHttp: () => ({ status: 204, contentType: "application/json", body: undefined }),
      },
      { resolveActorForRead: async () => ok(readActor) },
    );
    const res = await action({ request: req(), params: {}, context: {} });
    expect(res).toBeInstanceOf(Response);
  });
});

describe("handle() — deepened write context (ADR-0039 / ADR-0070)", () => {
  it("parses the Idempotency-Key header into ctx.idempotencyKey (trimmed)", async () => {
    const run = vi.fn(async (_ctx: WriteRunContext) => ok(1));
    const action = handle(
      {
        mode: "write",
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: async () => ok(writeActor) },
    );
    await action({
      request: req("https://app.example.test/", {
        method: "POST",
        headers: { "Idempotency-Key": "  key-123  " },
      }),
      params: {},
      context: {},
    });
    expect(run.mock.calls[0]?.[0].idempotencyKey).toBe("key-123");
  });

  it("leaves ctx.idempotencyKey undefined when the header is absent or blank", async () => {
    const run = vi.fn(async (_ctx: WriteRunContext) => ok(1));
    const action = handle(
      {
        mode: "write",
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: async () => ok(writeActor) },
    );
    await action({
      request: req("https://app.example.test/", {
        method: "POST",
        headers: { "Idempotency-Key": "   " },
      }),
      params: {},
      context: {},
    });
    expect(run.mock.calls[0]?.[0].idempotencyKey).toBeUndefined();
  });

  it("exposes the ADR-0070 audit attribution for the resolved actor", async () => {
    const run = vi.fn(async (_ctx: WriteRunContext) => ok(1));
    const action = handle(
      {
        mode: "write",
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: async () => ok(writeActor) },
    );
    await action({
      request: req("https://app.example.test/", { method: "POST" }),
      params: {},
      context: {},
    });
    expect(run.mock.calls[0]?.[0].audit).toEqual({
      orgId: writeActor.orgId,
      actorUserId: writeActor.userId,
    });
  });

  it("parses the request URL once into ctx.url (both modes)", async () => {
    const run = vi.fn(async (_ctx: ReadRunContext) => ok(1));
    const loader = handle(
      {
        mode: "read",
        run,
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveActorForRead: async () => ok(readActor) },
    );
    await loader({
      request: req("https://app.example.test/api/v1/reports?q=abc"),
      params: {},
      context: {},
    });
    expect(run.mock.calls[0]?.[0].url.searchParams.get("q")).toBe("abc");
  });
});

describe("methods() — the shared action dispatcher", () => {
  it("routes each verb to its handler", async () => {
    const patch = vi.fn(async () => new Response("patched"));
    const del = vi.fn(async () => new Response("deleted"));
    const action = methods({ PATCH: patch, DELETE: del });
    await action({
      request: req("https://x.test/", { method: "PATCH" }),
      params: {},
      context: {},
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  it("405s any verb without a handler, advertising the allowed set", async () => {
    const action = methods({ PATCH: async () => new Response("x") });
    const res = await action({
      request: req("https://x.test/", { method: "PUT" }),
      params: {},
      context: {},
    });
    expect(res.status).toBe(405);
    expect(await res.text()).toContain("PATCH");
  });

  it("methodNotAllowedLoader answers stray GETs with 405", async () => {
    const loader = methodNotAllowedLoader("POST");
    const res = await loader({ request: req(), params: {}, context: {} });
    expect(res.status).toBe(405);
  });
});

describe("handle() — end-to-end idempotency through the seam (ADR-0039)", () => {
  // A realistic write route: renameReport wired to in-memory fakes, invoked
  // through handle() exactly like api.v1.reports.$slug.ts's PATCH handler —
  // proving the wire statuses for replay / in-flight 409 / key-reuse 422 and
  // the 401/405 guards around them.
  async function makeRenameRoute() {
    const { renameReport } = await import("arp-application");
    const {
      InMemoryReportRepository,
      InMemoryAuditLogger,
      InMemoryIdentityStore,
      InMemoryOrgWriteGrantStore,
  InMemoryWriteGrantStore,
      PassThroughUnitOfWork,
      idempotencyTestDeps,
    } = await import("arp-application/testing");
    const { createReport, reportId, versionId } = await import("arp-domain");

    const reports = new InMemoryReportRepository();
    const audit = new InMemoryAuditLogger();
    const deps = {
      reports,
      audit,
      uow: new PassThroughUnitOfWork(),
      grants: new InMemoryWriteGrantStore(),
    orgWriteGrants: new InMemoryOrgWriteGrantStore(),
      identities: new InMemoryIdentityStore(),
      ...idempotencyTestDeps(),
    };
    const seeded = createReport({
      id: reportId("00000000-0000-7000-8000-0000000000c1"),
      orgId: anOrgId,
      folderId: aFolderId,
      slug: "abc1234567" as never,
      title: "Old",
      versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
      contentHash: "h".repeat(64),
      uploadedBy: aUserId,
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 1,
    }).report;
    await reports.save(seeded);

    const patchHandler = handle(
      {
        mode: "write",
        slug: true,
        parseBody: true,
        run: ({ actor, slug, body, idempotencyKey }) =>
          renameReport(
            deps,
            { orgId: actor.orgId, userId: actor.userId },
            { slug, title: typeof body.title === "string" ? body.title : "", idempotencyKey },
          ),
        toHttp: (result) =>
          result.ok
            ? {
                status: 200,
                contentType: "application/json",
                body: { slug: result.value.slug, title: result.value.title },
              }
            : errorToHttp(result.error),
      },
      {
        resolveUploadActor: async () => ok(writeActor),
        resolveReportSlug: async () => ok("abc1234567" as never),
        reports: stubReports,
      },
    );
    return { action: methods({ PATCH: patchHandler }), audit, deps };
  }

  function patchReq(title: string, key?: string) {
    return {
      request: req("https://app.example.test/api/v1/reports/abc1234567", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify({ title }),
      }),
      params: { slug: "abc1234567" },
      context: {},
    };
  }

  it("replays: an identical retry returns the recorded 200 body with exactly one audit row", async () => {
    const { action, audit } = await makeRenameRoute();
    const first = await action(patchReq("Renamed"));
    const second = await action(patchReq("Renamed"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ slug: "abc1234567", title: "Renamed" });
    expect(audit.recorded().length).toBe(1);
  });

  it("409s a concurrent in-flight duplicate", async () => {
    const { action, deps } = await makeRenameRoute();
    await deps.idempotency.begin(
      { actingUserId: aUserId, route: "PATCH /api/v1/reports/{slug}", key: "k-inflight" },
      deps.keyHasher.hash("abc1234567\nRenamed"),
    );
    const res = await action(patchReq("Renamed", "k-inflight"));
    expect(res.status).toBe(409);
  });

  it("422s an explicit key reused with a different payload", async () => {
    const { action } = await makeRenameRoute();
    await action(patchReq("One", "k-reuse"));
    const res = await action(patchReq("Two", "k-reuse"));
    expect(res.status).toBe(422);
  });

  it("401s before any idempotency work when there is no actor", async () => {
    const { renameReport } = await import("arp-application");
    void renameReport;
    const action = handle(
      {
        mode: "write",
        run: async () => ok(1),
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: async () => err({ kind: "Unauthenticated", message: "no session" }) },
    );
    const res = await methods({ PATCH: action })({
      request: req("https://x.test/", { method: "PATCH" }),
      params: {},
      context: {},
    });
    expect(res.status).toBe(401);
  });

  it("405s an unsupported method before auth ever runs", async () => {
    const resolve = vi.fn();
    const inner = handle(
      {
        mode: "write",
        run: async () => ok(1),
        toHttp: () => ({ status: 200, contentType: "application/json", body: {} }),
      },
      { resolveUploadActor: resolve },
    );
    const res = await methods({ PATCH: inner })({
      request: req("https://x.test/", { method: "POST" }),
      params: {},
      context: {},
    });
    expect(res.status).toBe(405);
    expect(resolve).not.toHaveBeenCalled();
  });
});
