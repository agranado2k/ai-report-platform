import type { MetaFunction } from "@remix-run/node";
import { Button, Card } from "arp-ui";
import { useState } from "react";

export const meta: MetaFunction = () => [{ title: "Centaur Spec — viewer" }];

// Smoke test for the view-origin CSS/hydration foundation (Phase 4c): proves the
// Tailwind build emits Forge & Ember utility classes (ADR-0058) AND that an
// arp-ui component hydrates on this origin (the click count only advances after
// React attaches on the client — a static SSR-only page could never respond).
// This is not the real landing page; the unified in-viewer experience replaces
// it once ADR-0063's client lands.
export default function Index() {
  const [pings, setPings] = useState(0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Card className="p-8">
        <h1 className="text-2xl font-semibold text-fg">Centaur Spec — viewer origin</h1>
        <p className="mt-3 text-muted">
          This origin (<code className="font-mono text-sm text-subtle">view.&lt;domain&gt;</code>)
          serves uploaded reports by slug. Hosted HTML/JS runs here under a strict CSP stack
          (ADR-013) so it cannot reach the dashboard origin.
        </p>
        <p className="mt-2 text-muted">
          Health endpoint:{" "}
          <a href="/health" className="text-brand hover:text-brand-hover">
            /health
          </a>
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Button variant="primary" onClick={() => setPings((n) => n + 1)}>
            Hydration check
          </Button>
          <span className="text-sm text-subtle">
            {pings === 0
              ? "Click to confirm React hydrated"
              : `Hydrated — ${pings} click${pings === 1 ? "" : "s"}`}
          </span>
        </div>
      </Card>
    </main>
  );
}
