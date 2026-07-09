// API-key management (ADR-0008 / ADR-0016). Mint a long-lived `arp_` key for
// programmatic callers (the MCP server, scripts, agents), list your keys, and
// revoke. The secret is shown EXACTLY ONCE, right after creation — we only store
// its HMAC, so it can never be re-displayed. Auth + the store come from the same
// seam/composition root the rest of the app uses.
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { createApiKey, listApiKeys, revokeApiKey } from "arp-application";
import {
  AppHeader,
  Badge,
  Button,
  buttonClass,
  Card,
  CopyButton,
  cx,
  Input,
  KeyIcon,
  PageShell,
} from "../components";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { apiKeyStore, appOrigin, auditLogger, deps } from "../server/container.server";
import { errorToJson } from "../server/http.server";

export const meta: MetaFunction = () => [{ title: "API keys & MCP — Centaur" }];

/** The MCP server lives at `mcp.<apex>` (a sibling of this app at `app.<apex>`);
 *  derive its `/mcp` endpoint from the app origin so the Connect helper is right
 *  in prod without the app holding an MCP_ORIGIN env. Assumes the `app.<apex>`
 *  topology — the host swap is a no-op on any other origin (preview `*.vercel.app`
 *  shows the preview host; an apex/custom APP_ORIGIN would want MCP_ORIGIN wired). */
function mcpEndpoint(request: Request): string {
  const url = new URL(appOrigin(request));
  url.host = url.host.replace(/^app\./, "mcp.");
  url.pathname = "/mcp";
  return url.toString();
}

export async function loader(args: LoaderFunctionArgs) {
  // Read path — never provisions (the app-wide gate already redirects anon
  // document requests to sign-in). A signed-in user with no mirror yet simply
  // has no keys; provisioning happens on the first mint (the POST below).
  const actor = await resolveActorForRead(args);
  if (!actor.ok) throw errorToJson(actor.error);
  const endpoint = mcpEndpoint(args.request);
  if (!actor.value) return json({ keys: [], mcpEndpoint: endpoint });
  const keys = await listApiKeys({ apiKeys: apiKeyStore() }, { userId: actor.value.userId });
  if (!keys.ok) throw errorToJson(keys.error);
  return json({ keys: keys.value, mcpEndpoint: endpoint });
}

export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) {
    if (actor.error.kind === "Unauthenticated") return redirect("/sign-in");
    return errorToJson(actor.error);
  }
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "revoke") {
    const id = String(form.get("id") ?? "");
    const revoked = await revokeApiKey(
      { apiKeys: apiKeyStore(), audit: auditLogger(), uow: deps().uow },
      { userId: actor.value.userId, orgId: actor.value.orgId },
      { id },
    );
    if (!revoked.ok) return errorToJson(revoked.error);
    return json({ ok: true as const });
  }

  // Default intent: create.
  const name = String(form.get("name") ?? "");
  const created = await createApiKey(
    { apiKeys: apiKeyStore(), audit: auditLogger(), uow: deps().uow },
    { userId: actor.value.userId, orgId: actor.value.orgId },
    { name },
  );
  if (!created.ok) return errorToJson(created.error);
  return json({ ok: true as const, secret: created.value.token, name: created.value.summary.name });
}

function formatDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString() : "never";
}

const navItem = "flex items-center gap-2 rounded-control px-3 py-2 text-sm";

export default function ApiKeys() {
  const { keys, mcpEndpoint: endpoint } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // `useActionData`'s serialized union narrows poorly across the create/revoke/error
  // shapes; the create-success branch is the only one carrying `secret`.
  const created =
    data && "secret" in data ? (data as unknown as { secret: string; name: string }) : null;

  return (
    <PageShell className="max-w-4xl">
      <AppHeader
        title="Settings"
        actions={
          <Link to="/" className={buttonClass("secondary", "sm")}>
            ← Back to reports
          </Link>
        }
      />

      <div className="grid gap-8 md:grid-cols-[180px_1fr]">
        {/* Settings sub-nav — one live section today; Members/Billing are placeholders. */}
        <aside>
          <p className="mb-2 px-3 font-mono text-xs uppercase tracking-wider text-subtle">
            Settings
          </p>
          <nav className="flex flex-col gap-0.5">
            <span
              className={cx(navItem, "bg-brand/15 font-semibold text-brand")}
              aria-current="page"
            >
              <KeyIcon className="h-4 w-4" />
              API keys &amp; MCP
            </span>
            <span className={cx(navItem, "text-subtle")} aria-disabled="true">
              Members
              <span className="ml-auto rounded border border-border px-1.5 text-[10px] uppercase">
                soon
              </span>
            </span>
            <span className={cx(navItem, "text-subtle")} aria-disabled="true">
              Billing
              <span className="ml-auto rounded border border-border px-1.5 text-[10px] uppercase">
                soon
              </span>
            </span>
          </nav>
        </aside>

        <section>
          <div className="mb-1 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-fg">API keys &amp; MCP tokens</h2>
              <p className="mt-1 max-w-prose text-sm text-muted">
                Connect AI agents to your reports over the Model Context Protocol. Each key is a
                bearer token with the <code className="font-mono text-xs">reports:write</code> scope
                — treat it like a password.
              </p>
            </div>
          </div>

          {/* Connect-to-Claude helper — teaches the MCP connection, not just secrets. */}
          <div className="my-5 rounded-card border border-border-strong bg-linear-to-br from-brand/10 to-surface p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <KeyIcon className="h-4 w-4 text-brand-hover" />
              Connect to Claude
              <span className="ml-1 rounded-full border border-border-strong px-2 py-0.5 font-mono text-[11px] text-accent">
                MCP
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">
              Add Centaur as a connector in Claude Desktop / Code, then paste a key below — the
              agent can search, upload, organise &amp; publish your reports.
            </p>
            <div className="mt-3 flex items-center gap-3 rounded-control border border-border bg-bg px-3 py-2 font-mono text-xs">
              <span className="shrink-0 text-subtle">endpoint</span>
              <span className="truncate text-brand-hover">{endpoint}</span>
              <CopyButton value={endpoint} className="ml-auto shrink-0" />
            </div>
          </div>

          <Card className="p-5">
            <Form method="post" className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <input type="hidden" name="intent" value="create" />
              <div className="flex-1">
                <label htmlFor="name" className="mb-1 block text-sm text-muted">
                  Key name
                </label>
                <Input id="name" name="name" placeholder="e.g. mcp-server, ci-uploader" />
              </div>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Creating…" : "Create key"}
              </Button>
            </Form>
          </Card>

          {data && "error" in data && data.error ? (
            <Card className="mt-4 p-4 text-sm text-danger" role="alert">
              ✗ {data.error}
            </Card>
          ) : null}

          {created ? (
            <Card className="mt-4 border-brand bg-brand/5 p-4" role="status" aria-live="polite">
              <p className="text-sm text-fg">
                ✓ Created <strong>{created.name}</strong> — copy it now, it{" "}
                <strong>won't be shown again</strong>:
              </p>
              <div className="mt-2 flex items-center gap-3 rounded-control bg-bg p-3">
                <code className="overflow-x-auto font-mono text-xs text-fg">{created.secret}</code>
                <CopyButton value={created.secret} className="ml-auto shrink-0" />
              </div>
            </Card>
          ) : null}

          <h3 className="mt-8 mb-3 text-sm font-medium text-muted">
            Your keys{keys.length ? ` (${keys.length})` : ""}
          </h3>
          {keys.length === 0 ? (
            <Card className="p-6 text-sm text-muted">No keys yet. Create one above.</Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className={cx(
                    "flex items-center gap-3 rounded-card border border-border bg-surface p-4",
                    k.revokedAt ? "opacity-60" : null,
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-border bg-surface-raised text-accent">
                    <KeyIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{k.name}</span>
                      <code className="font-mono text-xs text-subtle">{k.keyPrefix}••••</code>
                    </div>
                    <div className="text-xs text-subtle">
                      created {formatDate(k.createdAt)} · last used {formatDate(k.lastUsedAt)}
                    </div>
                  </div>
                  {k.revokedAt ? (
                    <Badge tone="danger">Revoked</Badge>
                  ) : (
                    <Badge tone="success">
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
                      Active
                    </Badge>
                  )}
                  {k.revokedAt ? null : (
                    <Form method="post" className="shrink-0">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="id" value={k.id} />
                      <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                        Revoke
                      </Button>
                    </Form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
