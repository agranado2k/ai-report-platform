// The code grader decides every tool-selection case, so its own behaviour is
// pinned here rather than discovered on a paid eval run. Keyless: these are
// pure functions over recorded provider output shapes.
//
// The output strings below are the shape the promptfoo Anthropic provider
// actually produces for a tool-using turn — text blocks verbatim, every other
// content block `JSON.stringify`d, joined by blank lines.
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS grader, loaded by promptfoo the same way.
import grade from "./tool-selection.js";

const call = (name: string, input: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "tool_use", id: "toolu_01", name, input });

const withMetadata = (metadata: Record<string, unknown>) => ({ test: { metadata } });

describe("tool-selection grader", () => {
  it("passes a positive case that calls the expected tool with the reference args", () => {
    const output = [
      "I'll publish that as a new version now.",
      call("reports_upload", { html: "<html/>", update_slug: "q3-revenue" }),
    ].join("\n\n");

    const result = grade(
      output,
      withMetadata({
        expected_tools: ["reports_upload"],
        expected_args: { reports_upload: { required: ["html", "update_slug"] } },
      }),
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it("gives partial credit when the right tool fires with the wrong arg shape", () => {
    const output = call("reports_upload", { html: "<html/>" });

    const result = grade(
      output,
      withMetadata({
        expected_tools: ["reports_upload"],
        expected_args: { reports_upload: { required: ["html", "update_slug"] } },
      }),
    );

    expect(result.pass).toBe(false);
    // coverage 0.6 + restraint 0.2 + half the arg checks (0.1).
    expect(result.score).toBeCloseTo(0.9, 5);
    expect(result.reason).toContain("update_slug");
  });

  it("passes a no-tool case only when nothing outside acceptable_tools fires", () => {
    const metadata = withMetadata({
      expected_tools: [],
      acceptable_tools: ["reports_get"],
      forbidden_tools: ["reports_delete"],
    });

    expect(grade("I'd rather confirm first — shall I delete it?", metadata).pass).toBe(true);
    expect(grade(call("reports_get", { slug: "draft-v1" }), metadata).pass).toBe(true);
    expect(grade(call("reports_delete", { slug: "draft-v1" }), metadata).pass).toBe(false);
  });

  it("zeroes restraint when a forbidden tool fires, even if the expected one did too", () => {
    const output = [
      call("reports_set_sharing", { slug: "roadmap", sharing: "org_edit" }),
      call("reports_set_acl", { slug: "roadmap", mode: "org" }),
    ].join("\n\n");

    const result = grade(
      output,
      withMetadata({
        expected_tools: ["reports_set_sharing"],
        forbidden_tools: ["reports_set_acl"],
      }),
    );

    expect(result.pass).toBe(false);
    expect(result.score).toBeCloseTo(0.8, 5);
    expect(result.reason).toContain("reports_set_acl");
  });

  it("does not penalise an acceptable lookup on the way to the expected tool", () => {
    const output = [
      call("folders_list", {}),
      call("reports_move", { slug: "q3-revenue", folder_id: "folder_01" }),
    ].join("\n\n");

    const result = grade(
      output,
      withMetadata({
        expected_tools: ["reports_move"],
        acceptable_tools: ["folders_list"],
      }),
    );

    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it("treats expected_any_of as one-of, not all-of", () => {
    const metadata = withMetadata({
      expected_tools: ["reports_get", "reports_get_acl"],
      expected_any_of: true,
    });

    expect(grade(call("reports_get", { slug: "q3-revenue" }), metadata).pass).toBe(true);
    expect(grade(call("reports_get_acl", { slug: "q3-revenue" }), metadata).pass).toBe(true);
    expect(grade("No tool call at all.", metadata).pass).toBe(false);
  });

  it("checks an enum argument by value, not just by presence", () => {
    const metadata = withMetadata({
      expected_tools: ["reports_set_sharing"],
      expected_args: {
        reports_set_sharing: { required: ["slug"], equals: { sharing: "org_edit" } },
      },
    });

    expect(
      grade(call("reports_set_sharing", { slug: "r", sharing: "org_edit" }), metadata).pass,
    ).toBe(true);
    const wrong = grade(call("reports_set_sharing", { slug: "r", sharing: "org_view" }), metadata);
    expect(wrong.pass).toBe(false);
    expect(wrong.reason).toContain("org_edit");
  });

  // The line-by-line scan only sees a tool call whose JSON sits on ONE line.
  // Nothing guarantees that: a provider that pretty-prints, or any change to
  // how promptfoo renders non-text blocks, silently yields "no tools called" —
  // which scores a negative case as a PASS. Failing open is the worst possible
  // direction for this grader, so parse the whole output first.
  it("extracts tool calls from pretty-printed (multi-line) provider output", () => {
    const output = [
      "I'll delete that report now.",
      "",
      JSON.stringify(
        { type: "tool_use", id: "toolu_03", name: "reports_delete", input: { slug: "draft-v1" } },
        null,
        2,
      ),
    ].join("\n");

    const negative = grade(
      output,
      withMetadata({ expected_tools: [], forbidden_tools: ["reports_delete"] }),
    );
    expect(negative.pass, "a pretty-printed forbidden call must still be caught").toBe(false);
    expect(negative.reason).toContain("reports_delete");
  });

  it("extracts tool calls from a whole-output JSON document (not one block per line)", () => {
    const output = JSON.stringify(
      {
        content: [
          { type: "text", text: "Publishing." },
          {
            type: "tool_use",
            id: "toolu_04",
            name: "reports_upload",
            input: { html: "<html/>", update_slug: "q3-revenue" },
          },
        ],
      },
      null,
      2,
    );

    const result = grade(
      output,
      withMetadata({
        expected_tools: ["reports_upload"],
        expected_args: { reports_upload: { required: ["html", "update_slug"] } },
      }),
    );
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  it("ignores prose that merely looks like JSON", () => {
    const output = "The payload would be {not really json, honest} — I have not sent it.";
    const result = grade(output, withMetadata({ expected_tools: [] }));
    expect(result.pass).toBe(true);
  });

  it("reads tool calls out of a structured (non-string) provider output too", () => {
    const output = [
      { type: "text", text: "Searching." },
      { type: "tool_use", id: "toolu_02", name: "reports_search", input: { q: "Pipeline health" } },
    ];

    const result = grade(
      output,
      withMetadata({
        expected_tools: ["reports_search"],
        expected_args: { reports_search: { required: ["q"] } },
      }),
    );

    expect(result.pass).toBe(true);
  });
});
