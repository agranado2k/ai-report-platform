// Unit tests for the Remix-`json()` problem adapter (route-seam deepening,
// goal 3): the dashboard's action handlers used to hand-roll their own
// status ternaries (`kind === "ValidationError" ? 422 : 400`), which collapsed
// every other AppError kind (NotFound, NotAllowed, PlanLimitExceeded, …) to a
// generic 400. `errorToJson` routes dashboard errors through the SAME
// problemFor/errorToHttp authority the JSON API uses, wrapped in a Remix
// `json()` response shaped `{ error: string }` — the shape the dashboard's
// `actionData` already renders.
import { describe, expect, it } from "vitest";
import { errorToJson, rejectNonJsonContentType } from "./http.server";

describe("errorToJson", () => {
  it("maps ValidationError to 422 (not a generic 400)", async () => {
    const res = errorToJson({ kind: "ValidationError", message: "bad field", field: "name" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "bad field" });
  });

  it("maps NotFound to 404 — previously collapsed to 400 by the dashboard's ternary", async () => {
    const res = errorToJson({ kind: "NotFound", message: "report not found" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "report not found" });
  });

  it("maps NotAllowed to 403 — previously collapsed to 400", async () => {
    const res = errorToJson({ kind: "NotAllowed", message: "not your folder" });
    expect(res.status).toBe(403);
  });

  it("maps PlanLimitExceeded to 402 — previously collapsed to 400", async () => {
    const res = errorToJson({ kind: "PlanLimitExceeded", message: "quota exceeded" });
    expect(res.status).toBe(402);
  });

  it("masks Unexpected's raw infra detail behind a generic message (500)", async () => {
    const res = errorToJson({ kind: "Unexpected", message: "pg: connection refused at 10.0.0.1" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/10\.0\.0\.1/);
  });
});

// SECURITY (PR #151 review, Fix 4): a save action must reject a non-JSON
// Content-Type with 415 before ever touching the body. SameSite=Lax cookies
// are this app's primary cross-site defense; this guard is belt-and-braces
// against a text/plain-Content-Type JSON-CSRF form POST (a plain HTML <form>
// can set Content-Type to text/plain or application/x-www-form-urlencoded,
// but never application/json, without a CORS preflight the browser would
// block cross-origin).
describe("rejectNonJsonContentType", () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request("https://app.example.test/reports/x/edit", {
      method: "POST",
      headers,
      body: "irrelevant",
    });

  it("returns null (proceed) for an application/json request", () => {
    expect(rejectNonJsonContentType(req({ "content-type": "application/json" }))).toBeNull();
  });

  it("returns null for application/json with a charset parameter", () => {
    expect(
      rejectNonJsonContentType(req({ "content-type": "application/json; charset=utf-8" })),
    ).toBeNull();
  });

  it("rejects text/plain with a 415", async () => {
    const res = rejectNonJsonContentType(req({ "content-type": "text/plain" }));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(415);
    expect(await res?.json()).toEqual({ error: "expected application/json" });
  });

  it("rejects application/x-www-form-urlencoded with a 415", () => {
    const res = rejectNonJsonContentType(
      req({ "content-type": "application/x-www-form-urlencoded" }),
    );
    expect(res?.status).toBe(415);
  });

  it("rejects a missing Content-Type with a 415", () => {
    const res = rejectNonJsonContentType(req());
    expect(res?.status).toBe(415);
  });
});
