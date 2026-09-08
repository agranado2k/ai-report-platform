// API-key management (ADR-0008 / ADR-0016). Mint a long-lived `arp_` key for
// programmatic callers (the MCP server, scripts, agents), list your keys, and
// revoke. The secret is shown EXACTLY ONCE, right after creation — we only store
// its HMAC, so it can never be re-displayed. Auth + the store come from the same
// seam/composition root the rest of the app uses. Presentation follows the App
// Shell Mockups report §04 (#338): a tabbed Settings section, a "Connect to
// Claude" MCP hero, scope selection as cards, the one-time reveal as a warning,
// and the keys as a table. The loader/action seams below are unchanged.
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
} from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  AlertTriangleIcon,
  AppHeader,
  Banner,
  Button,
  buttonClass,
  Card,
  Input,
  PageShell,
} from "../components";
import { ApiKeysTable } from "../components/settings/ApiKeysTable";
import { actionError, createdKeyView } from "../components/settings/api-keys";
import { ConnectPanel } from "../components/settings/ConnectPanel";
import { CreatedKeyReveal } from "../components/settings/CreatedKeyReveal";
import { ScopeCards } from "../components/settings/ScopeCards";
import { SettingsTabs } from "../components/settings/SettingsTabs";
import { scopesFromForm } from "../server/api-key-scopes.server";
import { resolveActorForRead, resolveUploadActor } from "../server/auth.server";
import { appOrigin, ops } from "../server/container.server";
import { errorToJson } from "../server/http.server";
import { mcpEndpointFrom } from "../server/mcp-endpoint";

export const meta: MetaFunction = () => [{ title: "API keys & MCP — Centaur" }];

/** The MCP `/mcp` endpoint for this request's app origin (ADR-0051). The
 *  derivation lives in `mcp-endpoint.ts` (unit-tested + shared with the ⌘K
 *  palette's "Copy MCP endpoint" action). */
function mcpEndpoint(request: Request): string {
  return mcpEndpointFrom(appOrigin(request));
}

export async function loader(args: LoaderFunctionArgs) {
  // Read path (the app-wide gate already redirects anon document requests to
  // sign-in). A signed-in user with no mirror yet is lazily provisioned on
  // this first read (ADR-0048 amendment 2026-08-01) and simply has no keys.
  const actor = await resolveActorForRead(args);
  if (!actor.ok) throw errorToJson(actor.error);
  const endpoint = mcpEndpoint(args.request);
  if (!actor.value) return json({ keys: [], mcpEndpoint: endpoint });
  const keys = await ops().listApiKeys({ userId: actor.value.userId });
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
    const revoked = await ops().revokeApiKey(
      { userId: actor.value.userId, orgId: actor.value.orgId },
      { id },
    );
    if (!revoked.ok) return errorToJson(revoked.error);
    return json({ ok: true as const });
  }

  // Default intent: create. The scope checkboxes submit as repeated `scopes`
  // entries; the use case validates the selection against KEY_ISSUABLE_SCOPES
  // (unknown/empty → 422 rendered by the error banner below).
  const name = String(form.get("name") ?? "");
  const created = await ops().createApiKey(
    { userId: actor.value.userId, orgId: actor.value.orgId },
    { name, scopes: scopesFromForm(form) },
  );
  if (!created.ok) return errorToJson(created.error);
  return json({
    ok: true as const,
    secret: created.value.token,
    name: created.value.summary.name,
    scopes: created.value.summary.scopes,
  });
}

export default function ApiKeys() {
  const { keys, mcpEndpoint: endpoint } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // The create-success branch is the only actionData shape carrying a non-null
  // secret; a null secret (an ADR-0039 replay of an explicit-keyed mint — never
  // re-displayed), a revoke, or an error all narrow away the reveal.
  const created = createdKeyView(data);
  const error = actionError(data);

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

      <SettingsTabs />

      <div className="mt-8 flex flex-col gap-10">
        {/* Connect-to-Claude hero — the thing people come to this page for. */}
        <ConnectPanel endpoint={endpoint} />

        <section>
          <div className="mb-1">
            <h2 className="text-lg font-semibold text-fg">Create a key</h2>
            <p className="mt-1 max-w-prose text-sm text-muted">
              Each key is a bearer token carrying only the scopes you pick — treat it like a
              password.
            </p>
          </div>

          <Card className="mt-4 p-5">
            <Form method="post" className="flex flex-col gap-5">
              <input type="hidden" name="intent" value="create" />
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-medium text-fg">
                  Name
                </label>
                <Input id="name" name="name" placeholder="e.g. Claude · laptop, ci-uploader" />
                <p className="mt-1 text-xs text-subtle">
                  Shown in the list so you can tell keys apart.
                </p>
              </div>
              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-fg">Scopes</legend>
                <ScopeCards />
              </fieldset>
              <Button type="submit" variant="primary" disabled={busy} className="self-start">
                {busy ? "Creating…" : "Create key"}
              </Button>
            </Form>
          </Card>

          {error ? (
            <Banner
              tone="danger"
              icon={<AlertTriangleIcon />}
              title="Couldn't create the key"
              className="mt-4"
            >
              {error}
            </Banner>
          ) : null}

          {created ? <CreatedKeyReveal created={created} /> : null}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-fg">
            Your keys{keys.length ? ` (${keys.length})` : ""}
          </h2>
          <ApiKeysTable keys={keys} busy={busy} />
        </section>
      </div>
    </PageShell>
  );
}
