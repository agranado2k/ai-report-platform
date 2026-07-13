// Pure row→domain mapping tests for DrizzleCommentRepository (rowToComment) —
// the query-level behavior is exercised by the pglite contract test; this
// isolates the `intent` mapping + backward-compat degrade (ADR-0064 Decision 8).
import { describe, expect, it } from "vitest";
import { rowToComment } from "./comment-repository";

type Row = Parameters<typeof rowToComment>[0];

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "00000000-0000-7000-8000-0000000000f1",
    reportId: "00000000-0000-7000-8000-0000000000c1",
    authorUserId: "00000000-0000-7000-8000-0000000000d1",
    parentCommentId: null,
    body: "hi",
    intent: "note",
    anchorJson: {
      versionPinned: {
        versionId: "00000000-0000-7000-8000-0000000000e1",
        textQuote: "the Q3 number",
      },
    },
    editedAt: null,
    resolvedAt: null,
    createdAt: new Date(1_700_000_000_000),
    ...overrides,
  } as Row;
}

describe("rowToComment intent mapping", () => {
  it("maps a stored intent through unchanged", () => {
    expect(rowToComment(baseRow({ intent: "enhancement" })).intent).toBe("enhancement");
    expect(rowToComment(baseRow({ intent: "remove" })).intent).toBe("remove");
  });

  it("degrades a legacy row with a null/absent intent to note", () => {
    expect(rowToComment(baseRow({ intent: null as unknown as Row["intent"] })).intent).toBe("note");
    const { intent: _drop, ...withoutIntent } = baseRow();
    expect(rowToComment(withoutIntent as Row).intent).toBe("note");
  });
});
