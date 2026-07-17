// Server `instructions` (ADR-0072, Layer 0). Sent once at MCP initialize —
// Claude Code/Gemini/Codex-style clients fold this into the system prompt;
// Claude Desktop currently ignores it (tool descriptions are the fallback
// channel, sharpened separately in tools.ts). Keep this SHORT and behavioral:
// teach the workflow verbs, not a manifesto. Do not add "always prefer this
// tool" style language — that reads as tool-poisoning.
//
// SECURITY: never imply this server can reach beyond the caller's own grants
// (ADR-0069) — the MCP is a thin client (ADR-003/0051); /api/v1 authorizes
// every call against the forwarded identity + the report ACL (ADR-0059/0060).
export const INSTRUCTIONS =
  "This server manages Centaur Spec reports — it only ever sees what your own " +
  "credentials already grant, never another user's or org's data. Core workflow: " +
  "upload an HTML document with reports_upload to create a report and get a " +
  "permanent, shareable view URL; re-upload to the SAME slug (update_slug) to " +
  "publish a new version while keeping that URL; use folders_list/folders_create " +
  "and reports_move to organize reports into folders; use reports_list_comments, " +
  "reports_add_comment, and reports_resolve_comment to read and resolve reviewer " +
  "feedback on a report.";

// Patterns an onboarding string must NOT match — each reads as "this server can
// reach any/all/every user's or org's data", the over-claim ADR-0069/0059/0060
// forbid. Defined once here so the instructions and the prompt tests assert the
// same guard (Layer 0 + Layer 2).
export const OVERCLAIM_PATTERNS: readonly RegExp[] = [
  /any (user|org|report)/i,
  /all (users|orgs|reports)/i,
  /every (user|org)/i,
];
