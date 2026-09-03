// Phase-1 upload UI — a minimal form that drives the real UploadReportUseCase
// against Neon + R2 (composition root in ../server/container.server). Paste HTML
// → it's stored as a report → view it at the canonical view.<domain>/<slug>. The
// production API is POST /api/v1/reports (ADR-0037); this page is the
// manually-testable surface.
import { type ActionFunctionArgs, json, type MetaFunction, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { uploadReport } from "arp-application";
import { AppHeader, Button, buttonClass, Card, Input, PageShell, Textarea } from "../components";
import { resolveUploadActor } from "../server/auth.server";
import { deps, viewOrigin } from "../server/container.server";
import { errorToJson } from "../server/http.server";

export const meta: MetaFunction = () => [{ title: "Upload a report — Centaur" }];

export async function action(args: ActionFunctionArgs) {
  const { request } = args;
  const form = await request.formData();
  const html = String(form.get("html") ?? "");
  const title = String(form.get("title") ?? "").trim() || undefined;
  if (!html.trim()) return json({ error: "Paste some HTML to upload." }, { status: 400 });

  // Require a signed-in session (ADR-0048); send anonymous visitors to sign-in.
  const actor = await resolveUploadActor(args);
  if (!actor.ok) {
    if (actor.error.kind === "Unauthenticated") return redirect("/sign-in");
    // Any other actor-resolution failure (e.g. Clerk org provisioning) routes
    // through the same problemFor/errorToHttp status authority the JSON API
    // uses — Unexpected's message is already masked behind a generic detail.
    return errorToJson(actor.error);
  }

  const result = await uploadReport(deps(), {
    actor: actor.value,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(html) },
    title,
  });
  if (!result.ok) return errorToJson(result.error);
  const out = result.value;
  const { slug, version, scanStatus } = out.result;

  // The version is committed as `pending`; the async scan drain (ADR-0045)
  // promotes it once it scans clean. The viewer shows the "scanning…" holding
  // page until then — no synchronous promotion here anymore. The link points at
  // the canonical view origin (ADR-002 / ADR-0038): view.<domain>/<slug>, via the
  // composition root's viewOrigin() (request-origin fallback on previews/dev).
  const viewUrl = `${viewOrigin(request)}/${slug}`;
  return json({ ok: true as const, slug, version, scanStatus, viewUrl });
}

export default function Upload() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  return (
    <PageShell className="max-w-3xl">
      <AppHeader
        title="Upload a report"
        actions={
          <Link to="/" className={buttonClass("secondary")}>
            ← Back to reports
          </Link>
        }
      />
      <p className="mb-6 text-sm text-muted">
        Paste an HTML document; it's stored and served back at its own URL.
      </p>
      <Card className="p-6">
        <Form method="post" className="flex flex-col gap-4">
          <Input name="title" placeholder="Title (optional)" aria-label="Report title" />
          <Textarea
            name="html"
            rows={12}
            aria-label="Report HTML"
            defaultValue={"<h1>Hello from Centaur Spec</h1>\n<p>It works.</p>"}
            className="font-mono"
          />
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </Form>
      </Card>
      {data && "error" in data && data.error ? (
        <Card className="mt-4 p-4 text-sm text-danger" role="alert">
          ✗ {data.error}
        </Card>
      ) : null}
      {data && "ok" in data && data.ok ? (
        <Card className="mt-4 p-4 text-sm text-fg" role="status" aria-live="polite">
          ✓ Uploaded as <code className="font-mono text-xs">{data.slug}</code> (v{data.version},
          scan: {data.scanStatus}) —{" "}
          <a href={data.viewUrl} className="text-brand hover:text-brand-hover">
            view it →
          </a>
        </Card>
      ) : null}
    </PageShell>
  );
}
