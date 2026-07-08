// Behavior tests for isCommentSubmitSuccess — the pure success/failure gate
// that decides whether NewCommentComposer's fetcher lifecycle should clear
// pendingSelection (PR #157 review, Fix 2). The mounted composer's actual
// mount/unmount + <ActionError> rendering stays e2e territory; this file
// covers only the pure decision.
import { describe, expect, it } from "vitest";
import { isCommentSubmitSuccess } from "./comment-composer-lifecycle";

describe("isCommentSubmitSuccess", () => {
  it("is false before any submission (idle, no data yet)", () => {
    expect(isCommentSubmitSuccess("idle", undefined)).toBe(false);
  });

  it("is false while the fetcher is submitting, even with stale prior data", () => {
    expect(isCommentSubmitSuccess("submitting", { ok: true })).toBe(false);
  });

  it("is false while the fetcher is loading (revalidating after submit)", () => {
    expect(isCommentSubmitSuccess("loading", { ok: true })).toBe(false);
  });

  it("is true once idle with a successful result", () => {
    expect(isCommentSubmitSuccess("idle", { ok: true })).toBe(true);
  });

  it("is false once idle with an error result — the composer must stay mounted", () => {
    expect(isCommentSubmitSuccess("idle", { error: "write grant revoked" })).toBe(false);
  });
});
