// Phase-1 upload UI — a minimal form that drives the real UploadReportUseCase
// against Neon + R2 (composition root in ../server/container.server). Paste HTML
// → it's stored as a report → view it at the canonical view.<domain>/<slug>. The
// production API is POST /api/v1/reports (ADR-0037); this page is the
// manually-testable surface.
import { type ActionFunctionArgs, json, type MetaFunction, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { uploadReport } from "arp-application";
import { resolveUploadActor } from "../server/auth.server";
import { deps, viewOrigin } from "../server/container.server";

export const meta: MetaFunction = () => [{ title: "Upload a report — ai-report-platform" }];

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
    return json({ error: `${actor.error.kind}: ${actor.error.message}` }, { status: 400 });
  }

  const result = await uploadReport(deps(), {
    actor: actor.value,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(html) },
    title,
  });
  if (!result.ok) {
    return json({ error: `${result.error.kind}: ${result.error.message}` }, { status: 400 });
  }
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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 760,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>Upload a report</h1>
      <p>Paste an HTML document; it's stored in R2 + Neon and served back at its slug.</p>
      <Form method="post">
        <p>
          <input
            name="title"
            placeholder="Title (optional)"
            style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
          />
        </p>
        <p>
          <textarea
            name="html"
            rows={12}
            defaultValue={"<h1>Hello from ai-report-platform</h1>\n<p>It works.</p>"}
            style={{ width: "100%", fontFamily: "monospace", padding: 8, boxSizing: "border-box" }}
          />
        </p>
        <button type="submit" disabled={busy} style={{ padding: "8px 16px" }}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </Form>
      {data && "error" in data && data.error ? (
        <p style={{ color: "crimson" }}>✗ {data.error}</p>
      ) : null}
      {data && "ok" in data && data.ok ? (
        <p style={{ color: "green" }}>
          ✓ Uploaded as <code>{data.slug}</code> (v{data.version}, scan: {data.scanStatus}) —{" "}
          <a href={data.viewUrl}>view it →</a>
        </p>
      ) : null}
    </main>
  );
}
