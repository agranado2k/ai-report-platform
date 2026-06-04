import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "ai-report-platform — dashboard" },
  {
    name: "description",
    content: "Phase 0c skeleton — dashboard placeholder.",
  },
];

export default function Index() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>ai-report-platform</h1>
      <p>
        Dashboard skeleton (Phase 0c). Feature surfaces — Clerk auth, folder tree, report
        management, API key issuance — land in Phase 1+.
      </p>
      <p>
        Health endpoint: <a href="/health">/health</a>
      </p>
    </main>
  );
}
