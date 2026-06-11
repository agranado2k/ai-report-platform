import { reportId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { CleanStubScanner } from "./clean-stub-scanner";

describe("CleanStubScanner", () => {
  it("always returns a clean verdict (Phase 1.5a stub)", async () => {
    const res = await new CleanStubScanner().scan({
      reportId: reportId("00000000-0000-4000-8000-000000000001"),
      versionId: versionId("00000000-0000-4000-8000-000000000002"),
    });

    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toBe("clean");
  });
});
