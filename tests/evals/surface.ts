// The ADR-0072 prompt surfaces, read straight out of `apps/mcp/src` so the eval
// suite is grounded in the SHIPPED text rather than a hand-copied paraphrase.
//
// Two consumers, one code path:
//   1. `fixtures/sync-fixtures.mjs` — bundles `fixtures/build-fixtures.ts`
//      (which calls in here) and writes the checked-in promptfoo fixtures.
//   2. `golden-set.test.ts` — the keyless smoke tier, which re-derives the same
//      surface and fails if the checked-in fixtures have drifted from it.
//
// Everything here is pure: `registerReadTools`/`registerWriteTools` only ever
// call `server.registerTool(...)` at registration time, so a capturing stub is
// enough and no `ApiClient` is ever exercised.
//
// NB `zod` is imported here and by `apps/mcp/src/tools.ts`. Both resolve
// through pnpm to the SAME store path, so `z.toJSONSchema` sees schemas from
// its own instance. If the two versions ever diverge this throws loudly rather
// than degrading — which is the failure mode we want.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "../../apps/mcp/src/client";
import { INSTRUCTIONS, OVERCLAIM_PATTERNS } from "../../apps/mcp/src/instructions";
import { registerReadTools, registerWriteTools } from "../../apps/mcp/src/tools";

export { INSTRUCTIONS, OVERCLAIM_PATTERNS };

/** One `server.registerTool(...)` call, captured verbatim. */
export interface RegisteredTool {
  readonly name: string;
  /** The agent-facing description — the Layer-0 prompt surface under test. */
  readonly description: string;
  /** The raw zod input shape (property name → schema). */
  readonly inputShape: Record<string, z.ZodType>;
}

/** Every tool `buildMcpServer` registers, in stable (sorted) order. */
export function captureRegisteredTools(): RegisteredTool[] {
  const captured: RegisteredTool[] = [];
  const capturingServer = {
    registerTool(
      name: string,
      config: { description?: string; inputSchema?: Record<string, z.ZodType> },
    ) {
      captured.push({
        name,
        description: config.description ?? "",
        inputShape: config.inputSchema ?? {},
      });
    },
  } as unknown as McpServer;

  // Never touched: the handlers are registered, not invoked.
  const stubClient = {} as ApiClient;
  registerReadTools(capturingServer, stubClient);
  registerWriteTools(capturingServer, stubClient);

  return captured.sort((a, b) => a.name.localeCompare(b.name));
}

/** The tool NAMES an MCP client sees — the vocabulary a golden-set case may name. */
export function registeredToolNames(): string[] {
  return captureRegisteredTools().map((tool) => tool.name);
}

/**
 * Expand `OVERCLAIM_PATTERNS` into the literal phrases a deterministic
 * assertion can forbid.
 *
 * promptfoo's `regex` assertion compiles `new RegExp(value)` with NO flags, so
 * it cannot express the `/i` these patterns carry. Every pattern is the same
 * trivial shape — one literal word followed by a single alternation group — so
 * expanding to phrases and forbidding them with `not-icontains-any` is exactly
 * equivalent AND case-insensitive. The shape is asserted, not assumed: a
 * future pattern that is a real regex throws here rather than being silently
 * mistranslated into a weaker guard.
 */
export function overclaimPhrases(): string[] {
  const SIMPLE_ALTERNATION = /^(\w+) \(([\w|]+)\)$/;
  return OVERCLAIM_PATTERNS.flatMap((pattern) => {
    const match = SIMPLE_ALTERNATION.exec(pattern.source);
    if (!match) {
      throw new Error(
        `OVERCLAIM_PATTERNS entry /${pattern.source}/ is no longer a "word (a|b|c)" alternation. ` +
          "Teach tests/evals/surface.ts how to express it deterministically before shipping it.",
      );
    }
    const [, head, alternatives] = match;
    return (alternatives ?? "").split("|").map((tail) => `${head} ${tail}`);
  });
}

/** An Anthropic Messages-API tool definition, as promptfoo hands it to the model. */
export interface AnthropicToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/** Project the registrations into the wire shape the provider sends. */
export function toolsForProvider(): AnthropicToolDefinition[] {
  return captureRegisteredTools().map((tool) => {
    // `$schema` is metadata about the JSON-Schema dialect, not part of the tool
    // contract — dropping it keeps the fixture diff about the prompt surface.
    const { $schema: _dialect, ...input_schema } = z.toJSONSchema(
      z.object(tool.inputShape),
    ) as Record<string, unknown> & { $schema?: string };
    return { name: tool.name, description: tool.description, input_schema };
  });
}
