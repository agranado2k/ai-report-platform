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
import { AppHeader, Button, buttonClass, Card, Input, PageShell } from "../components";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { apiKeyStore } from "../server/container.server";

export const meta: MetaFunction = () => [{ title: "API keys — ai-report-platform" }];

const GENERIC_500 = "Couldn't verify your account. Please try again.";

export async function loader(args: LoaderFunctionArgs) {
  // Read path — never provisions (the app-wide gate already redirects anon
  // document requests to sign-in). A signed-in user with no mirror yet simply
  // has no keys; provisioning happens on the first mint (the POST below).
  const actor = await resolveActorForRead(args);
  if (!actor.ok) throw json({ error: GENERIC_500 }, { status: 500 });
  if (!actor.value) return json({ keys: [] });
  const keys = await apiKeyStore().listForUser(actor.value.userId);
  if (!keys.ok) throw json({ error: "Couldn't load your API keys." }, { status: 500 });
  return json({ keys: keys.value });
}

export async function action(args: ActionFunctionArgs) {
  const actor = await resolveUploadActor(args);
  if (!actor.ok) {
    if (actor.error.kind === "Unauthenticated") return redirect("/sign-in");
    return json({ error: GENERIC_500 }, { status: 500 });
  }
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "revoke") {
    const id = String(form.get("id") ?? "");
    const revoked = await apiKeyStore().revoke(id, actor.value.userId);
    if (!revoked.ok) return json({ error: "Couldn't revoke that key." }, { status: 500 });
    return json({ ok: true as const });
  }

  // Default intent: create.
  const name = String(form.get("name") ?? "").trim();
  if (!name) return json({ error: "Give your key a name." }, { status: 400 });
  const created = await apiKeyStore().create({
    actingUserId: actor.value.userId,
    issuedInOrgId: actor.value.orgId,
    name,
    scopes: ["reports:write"],
  });
  if (!created.ok) {
    // Most likely the server pepper isn't configured yet (fail-closed, ADR-0008).
    return json(
      { error: "Couldn't create the key. Check that API keys are enabled." },
      { status: 500 },
    );
  }
  return json({ ok: true as const, secret: created.value.token, name });
}

function formatDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString() : "never";
}

export default function ApiKeys() {
  const { keys } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // `useActionData`'s serialized union narrows poorly across the create/revoke/error
  // shapes; the create-success branch is the only one carrying `secret`.
  const created =
    data && "secret" in data ? (data as unknown as { secret: string; name: string }) : null;

  return (
    <PageShell className="max-w-3xl">
      <AppHeader
        title="API keys"
        actions={
          <Link to="/" className={buttonClass("secondary")}>
            ← Back to reports
          </Link>
        }
      />
      <p className="mb-6 text-sm text-muted">
        Keys authenticate programmatic callers (the MCP server, scripts, agents) against the API
        with the <code className="font-mono text-xs">reports:write</code> scope. Treat a key like a
        password.
      </p>

      <Card className="p-6">
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
        <Card className="mt-4 border-brand p-4" role="status" aria-live="polite">
          <p className="text-sm text-fg">
            ✓ Created <strong>{created.name}</strong>. Copy it now — it{" "}
            <strong>won't be shown again</strong>:
          </p>
          <code className="mt-2 block overflow-x-auto rounded bg-surface-raised p-3 font-mono text-xs text-fg">
            {created.secret}
          </code>
        </Card>
      ) : null}

      <h2 className="mt-8 mb-3 text-sm font-medium text-muted">Your keys</h2>
      {keys.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No keys yet. Create one above.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((k) => (
            <li key={k.id}>
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-fg">{k.name}</span>
                    {k.revokedAt ? (
                      <span className="text-xs text-danger">revoked</span>
                    ) : (
                      <code className="font-mono text-xs text-muted">{k.keyPrefix}…</code>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    created {formatDate(k.createdAt)} · last used {formatDate(k.lastUsedAt)}
                  </div>
                </div>
                {k.revokedAt ? null : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="revoke" />
                    <input type="hidden" name="id" value={k.id} />
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Revoke
                    </Button>
                  </Form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
