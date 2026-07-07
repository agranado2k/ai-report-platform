import { describe, expect, it } from "vitest";
import { userId } from "./brand";
import { makeUserId, userIdToWire } from "./user-id";

describe("makeUserId / userIdToWire", () => {
  const uuid = "019ed70f-491d-707a-a263-4c31243f0c9f";

  it("round-trips a user id through the wire codec", () => {
    const wire = userIdToWire(userId(uuid));
    expect(wire.startsWith("user_")).toBe(true);
    const back = makeUserId(wire);
    expect(back.ok && back.value).toBe(uuid);
  });

  it("rejects a bare UUID — the wire form must be prefixed (ADR-0052 clean break)", () => {
    const r = makeUserId(uuid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects a wrong-entity prefix (a folder_ id is not a user_ id)", () => {
    const wire = userIdToWire(userId(uuid)).replace("user_", "folder_");
    expect(makeUserId(wire).ok).toBe(false);
  });

  it("rejects a non-id value with a ValidationError", () => {
    const r = makeUserId("not-an-id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects an empty string", () => {
    expect(makeUserId("").ok).toBe(false);
  });
});
