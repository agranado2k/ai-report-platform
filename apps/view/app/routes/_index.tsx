import type { MetaFunction } from "@remix-run/node";
import { Card } from "arp-ui";

export const meta: MetaFunction = () => [{ title: "Centaur Spec — viewer" }];

// The viewer origin's landing page (`view.<domain>/`). This origin has no
// index of its own — every real destination is a report at `/<slug>`
// (public, read-only, ADR-002/0038) or `/<slug>/edit` (authenticated, the
// unified editing experience, ADR-0063). A bare visit here carries no slug,
// so there is nothing to serve; this is a minimal, on-brand explainer, not a
// dashboard. Replaces the interim hydration-smoke-test click-counter that
// proved the Tailwind build + arp-ui hydration foundation during Phase 4c —
// that check now lives in the shipped `/<slug>/edit` route itself.
export default function Index() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Card className="p-8">
        <h1 className="text-2xl font-semibold text-fg">Centaur Spec — viewer</h1>
        <p className="mt-3 text-muted">
          This origin (<code className="font-mono text-sm text-subtle">view.&lt;domain&gt;</code>)
          serves uploaded reports by slug. Hosted HTML/JS runs here under a strict CSP stack
          (ADR-013) so it cannot reach the dashboard origin.
        </p>
        <p className="mt-2 text-muted">
          Have a report link? Open it directly — reports are served at{" "}
          <code className="font-mono text-sm text-subtle">/&lt;slug&gt;</code>.
        </p>
        <p className="mt-2 text-muted">
          Health endpoint:{" "}
          <a href="/health" className="text-brand hover:text-brand-hover">
            /health
          </a>
        </p>
      </Card>
    </main>
  );
}
