// Unit tests for the `handle()` combinator (route-seam deepening). Every
// /api/v1 route hand-inlined the same actor-resolution → slug-resolution →
// body-parse → run-use-case → map-Result → toResponse choreography; these
// tests exercise that choreography in isolation, with FAKE actor/slug
// resolvers injected — no real Clerk session or DB is needed.
import type { ReportRepository, UploadActor } from "arp-application";
import { err, folderId, ok, orgId, userId, validationError } from "arp-domain";
import { describe, expect, it, vi } from "vitest";
import { handle, type ReadActor, type ReadRunContext, type WriteRunContext } from "./handle.server";

/** A stub `ReportRepository` — tests that fake `resolveReportSlug` never touch
 *  it, but `handle()` still passes it through, so it must not require the real
 *  env-backed container (which throws outside a fully-configured environment). */
const stubReports = () => ({}) as ReportRepository;

const anOrgId = orgId("00000000-0000-7000-8000-0000000000a1");
const aUserId = userId("00000000-0000-7000-8000-0000000000u1");
const aFolderId = folderId("00000000-0000-7000-8000-0000000000f1");

const readActor: ReadActor = { userId: aUserId, orgId: anOrgId };
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
