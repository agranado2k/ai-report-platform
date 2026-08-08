// The prompt under eval: a host agent that has just connected to
// `mcp.centaurspec.com` and is deciding what to do with a user's request.
//
// The system message is the ADR-0072 Layer-0 `instructions` string VERBATIM
// (generated into `fixtures/instructions.txt` from `apps/mcp/src/instructions.ts`),
// and the tool definitions the provider carries are the shipped ones. Nothing
// is paraphrased and nothing is added: the eval measures the real surface, so
// a wording change in `instructions.ts` or `tools.ts` changes what is measured.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INSTRUCTIONS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "instructions.txt"),
  "utf8",
).trim();

export default function mcpClientPrompt({ vars }) {
  return [
    { role: "system", content: INSTRUCTIONS },
    { role: "user", content: String(vars.scenario) },
  ];
}
