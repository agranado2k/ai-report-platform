// Behavior tests for the version-summary → client DTO mapping (Phase 1
// "surface version authorship"). Mirrors comment-dto.server.test.ts's shape:
// covers the dedupe (uniqueVersionAuthorIds) and map-back (versionsToDto)
// halves separately, since they're the two things the loader composes
// around a single IdentityStore round-trip.
import { userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { uniqueVersionAuthorIds, versionsToDto } from "./version-dto.server";

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

describe("versionsToDto", () => {
  it("maps each version's resolved author email back onto its DTO", () => {
    const emailByAuthor = new Map([
      [authorA, "alice@example.com"],
      [authorB, "bob@example.com"],
    ]);
    const dtos = versionsToDto(summaries, versionA2, emailByAuthor);
    expect(dtos.map((d) => d.authorEmail)).toEqual([
      "alice@example.com",
      "alice@example.com",
      "bob@example.com",
    ]);
  });

  it("falls back to null authorEmail when the lookup map has no entry for that author", () => {
    const emailByAuthor = new Map([[authorA, "alice@example.com"]]);
    // authorB has no entry at all (as if findEmailByUserId's result was never mapped in)
    const dtos = versionsToDto(summaries, versionA2, emailByAuthor);
    expect(dtos.find((d) => d.versionNo === 3)?.authorEmail).toBeNull();
  });

  it("falls back to null authorEmail when the lookup map explicitly resolved a miss (null)", () => {
    const emailByAuthor = new Map<typeof authorA, string | null>([
      [authorA, null],
      [authorB, "bob@example.com"],
    ]);
    const dtos = versionsToDto(summaries, versionA2, emailByAuthor);
    expect(dtos.find((d) => d.versionNo === 1)?.authorEmail).toBeNull();
  });

  it("marks isLive true only for the version matching liveVersionId", () => {
    const dtos = versionsToDto(summaries, versionA2, new Map());
    expect(dtos.find((d) => d.versionNo === 2)?.isLive).toBe(true);
    expect(dtos.find((d) => d.versionNo === 1)?.isLive).toBe(false);
    expect(dtos.find((d) => d.versionNo === 3)?.isLive).toBe(false);
  });

  it("treats a null liveVersionId as no version being live", () => {
    const dtos = versionsToDto(summaries, null, new Map());
    expect(dtos.every((d) => d.isLive === false)).toBe(true);
  });

  it("carries scanStatus, origin, sizeBytes, uploadedAt, versionNo through unchanged", () => {
    const dtos = versionsToDto(summaries, null, new Map());
    const first = dtos[0];
    expect(first).toMatchObject({
      versionNo: 2,
      uploadedAt: 1_700_000_200_000,
      scanStatus: "clean",
      origin: "editor",
      sizeBytes: 2048,
    });
  });
});
