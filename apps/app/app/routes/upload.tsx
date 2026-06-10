// Phase-1 upload UI — a minimal form that drives the real UploadReportUseCase
// against Neon + R2 (composition root in ../server/container.server). Paste HTML
// → it's stored as a report → view it at /r/<slug>. The production API is
// POST /api/v1/reports (ADR-0037); this page is the manually-testable surface.
import { type ActionFunctionArgs, json, type MetaFunction } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { processScanResult, uploadReport } from "arp-application";
import { makeSlug } from "arp-domain";
import { DEMO_ACTOR, deps, ensureDevIdentity } from "../server/container.server";

export const meta: MetaFunction = () => [{ title: "Upload a report — ai-report-platform" }];

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const html = String(form.get("html") ?? "");
  const title = String(form.get("title") ?? "").trim() || undefined;
  if (!html.trim()) return json({ error: "Paste some HTML to upload." }, { status: 400 });

  await ensureDevIdentity();
  const result = await uploadReport(deps(), {
    actor: DEMO_ACTOR,
    upload: { filename: "index.html", bytes: new TextEncoder().encode(html) },
    title,
  });
  if (!result.ok) {
    return json({ error: `${result.error.kind}: ${result.error.message}` }, { status: 400 });
  }
  const { slug, version, scanStatus } = result.value.result;

  // Phase-1 always-clean scan stub: synchronously complete the scan so the new
  // version promotes to live immediately (ADR-0037 §8). Skipped on idempotent
  // replay (already scanned on the first request). The real scanner (Phase 1.5)
  // invokes processScanResult the same way with the actual verdict. Best-effort:
  // if it fails the upload still succeeded — the version stays `pending` and the
  // viewer shows the "scanning…" holding page until a retry promotes it.
  if (!result.value.replayed) {
    const sg = makeSlug(slug);
    const found = sg.ok ? await deps().reports.findBySlug(sg.value) : null;
    const report = found?.ok ? found.value : null;
    const newVersion = report?.versions.find((v) => v.versionNo === version);
    if (report && newVersion) {
      await processScanResult(deps(), {
        reportId: report.id,
        versionId: newVersion.id,
        verdict: "clean",
      });
    }
  }

  return json({ ok: true as const, slug, version, scanStatus, viewUrl: `/r/${slug}` });
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
