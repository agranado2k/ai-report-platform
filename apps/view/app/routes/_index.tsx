import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "ai-report-platform — viewer" }];

export default function Index() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>ai-report-platform — viewer origin</h1>
      <p>
        This origin (<code>view.&lt;domain&gt;</code>) serves uploaded reports by slug. Hosted
        HTML/JS runs here under a strict CSP stack (ADR-013) so it cannot reach the dashboard
        origin.
      </p>
      <p>
        Health endpoint: <a href="/health">/health</a>
      </p>
    </main>
  );
}
