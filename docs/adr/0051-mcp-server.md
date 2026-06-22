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
  - **Interactive clients** (Claude Desktop/Code) use **Clerk OAuth** (built in PR 4): the server is an OAuth 2.1 resource server — it serves RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` (pointing at Clerk as the AS, derived from the publishable key) and replies `401 + WWW-Authenticate` to start discovery. It verifies the inbound Clerk OAuth access token via `@clerk/backend` `authenticateRequest({ acceptsToken: "oauth_token" })`, then **forwards that same token** to `/api/v1`, which re-verifies it the same way (`acceptsToken: "oauth_token"`) — OAuth-in → **OAuth-token forward**. `/api/v1`'s actor-resolution seam gains an `oauth_token` branch alongside the `arp_` key and browser-session branches; no `audience` is enforced on re-verification, so the token's RFC-8707 binding to the MCP resource doesn't block its use at our own API (Clerk's supported multi-backend pattern). The MCP + `/api/v1` both gain/keep `CLERK_SECRET_KEY` + publishable key; **fail-closed** — unset ⇒ OAuth off, `arp_` path unaffected. **(Supersedes the original session-token-out design — see the amendment below.)**
  - **Operator setup (click-ops, both Clerk instances):** create a Clerk **OAuth application** on the dev + live instances, enable **Dynamic Client Registration** (required — without it the AS metadata advertises no `registration_endpoint` and clients can't self-register, "couldn't register with the sign-in service"), set scopes + the `https://mcp.<apex>/mcp` resource. No Terraform resource exists for Clerk OAuth apps (dashboard-only) — an ADR-017 exception like the per-provider PATs. Then test via the MCP Inspector's OAuth mode.

### Amendment (2026-06-22): session-token-out → OAuth-token forward

PR 4 originally minted a short-lived Clerk **session token** (`POST /v1/sessions` → `…/tokens`) and forwarded that, to avoid forwarding the inbound OAuth token. This worked against the **development** Clerk instance but **failed in production**: Clerk's create-session Backend API is *"intended only for use in testing, and is not available for production instances"* — the live MCP returned `502` on every OAuth call. Clerk documents **no** server-side way to mint a session JWT for a user on production (sign-in tokens are frontend-consumed; `…/tokens` needs an existing session). Per Clerk's own guidance, the fix is to **verify the OAuth token directly at `/api/v1`** (`acceptsToken: "oauth_token"`) and have the MCP forward it. This makes the OAuth path a **single-vendor token forward**, same as the `arp_` key path (see the deviation note) — the accepted trade-off for a setup where the MCP and `/api/v1` are both ours on the same Clerk instance.

### Security posture: audience binding NOT enforced (deliberate, researched)

A resource server should ideally reject an OAuth token whose `aud` isn't its own resource (RFC 8707 / 9728 replay protection). We **deliberately do NOT** enforce `audience` on `authenticateRequest` here, for a researched reason: **Clerk does not document what populates an OAuth access token's `aud` claim** — its token-introspection payload exposes `client_id`/`scope`/`sub`/`org_id` and **no `aud`**, and the MCP guides never pass `audience`. So enforcing `audience: "https://mcp.<apex>/mcp"` would, on current evidence, likely **reject every legitimate token** and break the live flow. `authorizedParties` is also inapplicable — it's an origin allowlist for the session-cookie attack, and our clients self-register via **DCR** (dynamic `client_id`, nothing stable to pin). The residual replay risk is bounded: a forwarded token must still be a **valid Clerk token for our own instance**, and `/api/v1` re-verifies it independently. **Follow-up:** decode a real minted token (`resource=https://mcp.<apex>/mcp`) to learn the actual `aud`; **iff** it equals the resource URI, add `audience` enforcement at the MCP (`verifyOAuthUser`) for proper resource binding.

## Spec-deviation note (token passthrough)

The MCP spec (rev 2025-11-25, §Security best practices) forbids an MCP server from **passing a client's token through** to an upstream API. Both our paths forward the inbound credential to `/api/v1`: the **API key** (headless) and — after the amendment above — the **Clerk OAuth token** (interactive). The spec's MUST-NOTs target the confused-deputy / wrong-audience case (forwarding a token to a *third party* whose audience it isn't). Ours is a deliberate **single-vendor** setup: the MCP and `/api/v1` are both ours, on the same Clerk instance, and `/api/v1` independently re-verifies the OAuth token (it doesn't trust the MCP's say-so). We tried the spec-clean alternative (mint a separate Clerk session token, OAuth-in → session-token-out) and it proved **impossible on a production Clerk instance** (create-session is testing-only — see the amendment). Recorded so the passthrough is a conscious, documented trade-off — not an oversight.

## Consequences

- **Good**: zero-install hosted MCP; reuses the live API + its auth/idempotency/error model; no new runtime or datastore; testable REST-mapping layer (unit-tested under `apps/mcp/src/**`, unusual for an app here — justified because the logic is pure).
- **Trade-offs**: a third Vercel project to operate; the API-key passthrough deviation above; stateless mode forgoes server-initiated streaming/notifications (fine for request/response tools). `apps/mcp` adds Express + the MCP SDK as runtime deps in a new boundary app (no domain/application coupling, so ADR-024 is unaffected).

## More information

- Verified facts (2026 docs): spec rev **2025-11-25**; Streamable HTTP current, HTTP+SSE deprecated (since 2025-03-26); SDK ≥1.26 stateless = fresh transport per request; OAuth verified via `@clerk/backend` `authenticateRequest({ acceptsToken: "oauth_token" })` (machine-auth, ≥2.x); Vercel Node runtime runs a default-exported Express app.
- Implementation: `apps/mcp/src/{index,client,tools,server,app,env,local}.ts` (bundled by esbuild) + the committed `apps/mcp/api/index.mjs` shim. Infra: `infra/terraform/envs/prod/main.tf` (`vercel_mcp`) + `infra/terraform/envs/shared/main.tf` (`mcp` CNAME). Credential: ADR-0008. Contract: `docs/api/openapi.yaml`.
