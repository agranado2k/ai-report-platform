// Behavior tests for version-author id deduplication (Phase 1 "surface
// version authorship"). Covers `uniqueVersionAuthorIds`, the dedupe the loader
// runs before its single IdentityStore round-trip.
import { userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { uniqueVersionAuthorIds } from "./version-dto.server";

const authorA = userId("11111111-1111-7111-8111-111111111111");
const authorB = userId("22222222-2222-7222-8222-222222222222");

const versionA1 = versionId("aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa");
const versionA2 = versionId("bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb");
const versionB1 = versionId("cccccccc-cccc-7ccc-8ccc-cccccccccccc");

const summaries = [
  {
    id: versionA2,
    versionNo: 2,
    uploadedBy: authorA,
    uploadedAt: 1_700_000_200_000,
    scanStatus: "clean" as const,
    sizeBytes: 2048,
    origin: "editor" as const,
  },
  {
    id: versionA1,
    versionNo: 1,
    uploadedBy: authorA,
    uploadedAt: 1_700_000_100_000,
    scanStatus: "clean" as const,
    sizeBytes: 1024,
    origin: "upload" as const,
  },
  {
    id: versionB1,
    versionNo: 3,
    uploadedBy: authorB,
    uploadedAt: 1_700_000_300_000,
    scanStatus: "flagged" as const,
    sizeBytes: 4096,
    origin: "upload" as const,
  },
];

describe("uniqueVersionAuthorIds", () => {
  it("dedupes a repeated author down to a single id", () => {
    expect(uniqueVersionAuthorIds(summaries)).toEqual([authorA, authorB]);
  });

  it("returns an empty array for an empty version list", () => {
    expect(uniqueVersionAuthorIds([])).toEqual([]);
  });
});
