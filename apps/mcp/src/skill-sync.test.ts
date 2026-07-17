import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Claude Code plugin (Layer 2) ships a COPY of the canonical Layer-1 skill,
// since a distributable package can't reference a file outside its own tree.
// A README note asks editors to keep them in sync — this test enforces it so a
// stale packaged copy can't ship (ADR-0072). If it fails: re-copy the canonical
// file over the packaged one (don't edit the packaged copy independently).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const CANONICAL = "../skill/centaur-spec/SKILL.md";
const PACKAGED = "../packaging/claude-code-plugin/skills/centaur-spec/SKILL.md";

describe("SKILL.md packaging sync (ADR-0072, Layer 1/2)", () => {
  it("the packaged plugin copy is byte-identical to the canonical skill", () => {
    expect(read(PACKAGED)).toBe(read(CANONICAL));
  });
});
