# ADR-0051: Remote MCP server — stateless Streamable HTTP, thin client over /api/v1

- **Status**: Accepted
- **Date**: 2026-06-22
- **Deciders**: agranado2k
- **Supersedes / amends**: refines **ADR-003** (HTTP API is the source of truth; MCP is a thin client) — keeps the thin-client principle but changes the *packaging* from the spec's "npm package via `npx` (stdio)" to a **remote HTTP server**. Builds on ADR-0008 (API keys), ADR-0039 (idempotency), ADR-0040 (RFC-9457 errors).
- **Superseded by**: —

## Context and problem statement

AI agents should manage reports (search / get / upload / update / move / delete / organise) without hand-crafting HTTP. MCP is the agent-native interface. ADR-003 fixed the principle — the MCP is a *thin client* over `/api/v1`, never a second source of truth — and framed it as a local `npx` stdio package reading an API key from the environment.

Two things have changed since: (1) we want a **hosted, zero-install** surface an agent connects to over the network, not a package each user installs; (2) we now have first-class **API-key auth** (ADR-0008) and Clerk's **MCP OAuth** support. So the question is the server's shape (transport, framework, deployment) and how it authenticates without becoming a second source of truth or a credential-laundering proxy.

## Decision drivers

- **Thin client, no business logic** (ADR-003): every tool maps to an existing `/api/v1` call.
- **Serverless-friendly**: deploy on Vercel alongside `apps/app`/`apps/view`, no new runtime to operate.
- **Agent-usable auth** today (long-lived API key), with a path to interactive OAuth.
- **Current MCP norms** (verified 2026 against the spec rev `2025-11-25` + the TS SDK + Vercel + Clerk docs).

## Considered options

- **Transport**: local **stdio `npx` package** (the spec's original) vs **remote Streamable HTTP** (chosen — hosted, zero-install; stdio is deprecated-adjacent for hosted use and can't be a shared URL). HTTP+SSE is deprecated, so Streamable HTTP it is.
- **State**: stateful sessions (need Redis on serverless) vs **stateless** (chosen — `sessionIdGenerator: undefined`, `enableJsonResponse: true`; a fresh `McpServer` + transport per request, required by SDK ≥1.26).
- **Framework**: Next.js/Remix vs **Express** (chosen by the operator — the SDK's `StreamableHTTPServerTransport` integrates directly with Node/Express `req`/`res`, and Clerk ships `@clerk/mcp-tools/express` for the OAuth layer).
- **MCP → data path**: compose `arp-application` use cases **in-process** vs **call `/api/v1` over HTTP** (chosen — honors ADR-003, dogfoods the real API per ADR-019; the in-process option was explicitly rejected).
- **Auth**: short-lived Clerk-JWT passthrough (rejected — JWTs expire in minutes, unusable for agents) vs **API keys + Clerk OAuth** (chosen).

## Decision outcome

- **`apps/mcp` — a remote, stateless Streamable-HTTP MCP server** (`@modelcontextprotocol/sdk` ≥1.26) on **Express**, deployed as a **Vercel Node serverless function** (no framework preset; `vercel.json` rewrites all paths to the function + serves a static `public/` landing). Domain `mcp.<apex>`. One Terraform `vercel-app` module instance + a `mcp` CNAME, applied by CI/CD on merge.
- **Build-time bundling (not per-file transpile).** Because `apps/mcp` is `type: module`, `@vercel/node` does NOT bundle it — it runs native ESM via Node's resolver, where extensionless relative imports fail (`ERR_MODULE_NOT_FOUND`). Rather than sprinkle `.js` extensions across TypeScript *source* (a workaround), modules are resolved at **build time**: `pnpm build` runs **esbuild** to bundle `src/index.ts` (+ all relative imports inlined; deps kept external) into `dist/server.mjs`, and a tiny committed `api/index.mjs` re-exports that bundle as the function. Source imports stay extensionless, matching the rest of the (bundled) repo. `dist/**` is a declared Turbo build output so a cache hit restores it.
- **Thin client over `/api/v1`** (ADR-003): each tool `fetch`es the live API via a per-request `ApiClient` bound to the caller's `Authorization`; RFC-9457 problems (ADR-0040) become `isError` tool results, secrets omitted; writes (PR 3) carry an `Idempotency-Key` (ADR-0039). No DB/use-case access.
- **Tools** are intent-level + domain-prefixed with read/destructive/idempotent annotations. This slice ships the **read tools** `reports_search` + `folders_list`; write tools (`reports_upload`/`update`/`move`/`delete`, folder CRUD) land next; `set_acl`/`grant` wait on the unbuilt sharing feature.
- **Auth**:
  - **Headless agents** present an **`arp_` API key** as `Authorization: Bearer`; the server forwards it to `/api/v1`.
  - **Interactive clients** (Claude Desktop/Code) will use **Clerk OAuth** via `@clerk/mcp-tools/express` (next slice): the server is an OAuth 2.1 resource server (protected-resource metadata, audience validation), and after identifying the user mints/looks up that user's API key for the downstream call (OAuth-in → API-key-out; the OAuth token is never forwarded).

## Spec-deviation note (token passthrough)

The MCP spec (rev 2025-11-25, §Security best practices) forbids an MCP server from **passing a client's token through** to an upstream API. Our headless path forwards the caller's **API key** to `/api/v1`. The spec never names API keys (its MUST-NOTs are written about OAuth access tokens), so this is outside the *letter* of the rule, but it matches the *spirit* of the passthrough anti-pattern. We accept it deliberately for a **single-vendor** setup (the MCP and `/api/v1` are both ours, the key's audience *is* our platform), and the OAuth path (next slice) is spec-clean (no token forwarded). Recorded so it's a conscious, documented trade-off — not an oversight.

## Consequences

- **Good**: zero-install hosted MCP; reuses the live API + its auth/idempotency/error model; no new runtime or datastore; testable REST-mapping layer (unit-tested under `apps/mcp/src/**`, unusual for an app here — justified because the logic is pure).
- **Trade-offs**: a third Vercel project to operate; the API-key passthrough deviation above; stateless mode forgoes server-initiated streaming/notifications (fine for request/response tools). `apps/mcp` adds Express + the MCP SDK as runtime deps in a new boundary app (no domain/application coupling, so ADR-024 is unaffected).

## More information

- Verified facts (2026 docs): spec rev **2025-11-25**; Streamable HTTP current, HTTP+SSE deprecated (since 2025-03-26); SDK ≥1.26 stateless = fresh transport per request; Clerk `@clerk/mcp-tools` (incl. `/express`) for the OAuth layer; Vercel Node runtime runs a default-exported Express app.
- Implementation: `apps/mcp/src/{index,client,tools,server,app,env,local}.ts` (bundled by esbuild) + the committed `apps/mcp/api/index.mjs` shim. Infra: `infra/terraform/envs/prod/main.tf` (`vercel_mcp`) + `infra/terraform/envs/shared/main.tf` (`mcp` CNAME). Credential: ADR-0008. Contract: `docs/api/openapi.yaml`.
