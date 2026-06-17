import { SignedIn, SignedOut, UserButton } from "@clerk/remix";
import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { listReports } from "arp-application";
import { resolveUploadActor } from "../server/auth.server";
import { deps, viewOrigin } from "../server/container.server";

export const meta: MetaFunction = () => [
  { title: "Your reports — ai-report-platform" },
  { name: "description", content: "Dashboard: your reports." },
];

// The dashboard list (ADR-0036). The page is behind the root auth gate, so a
// session is present; resolveUploadActor yields the internal org id (provisioning
// the identity on first sight, idempotent — ADR-0048), then listReports projects
// the org's reports newest-first.
export async function loader(args: LoaderFunctionArgs) {
  const actor = await resolveUploadActor(args);
  const viewBase = viewOrigin(args.request);
  if (!actor.ok) return json({ reports: [], viewBase });
  const listed = await listReports({ reports: deps().reports }, { orgId: actor.value.orgId });
  return json({ reports: listed.ok ? listed.value : [], viewBase });
}

export default function Index() {
  const { reports, viewBase } = useLoaderData<typeof loader>();
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Your reports</h1>
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
        <SignedOut>
          <Link to="/sign-in">Sign in</Link>
        </SignedOut>
      </header>

      <p>
        <Link to="/upload">Upload a report →</Link>
      </p>

      {reports.length === 0 ? (
        <p style={{ color: "#666" }}>
          No reports yet. <Link to="/upload">Upload your first →</Link>
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {reports.map((r) => (
            <li
              key={r.slug}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <span>
                <a href={`${viewBase}/${r.slug}`}>{r.title}</a>{" "}
                <code style={{ fontSize: 12, color: "#999" }}>{r.slug}</code>
              </span>
              <StatusBadge isPublished={r.isPublished} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Published = a clean version is live; otherwise the report is still pending its scan. */
function StatusBadge({ isPublished }: { isPublished: boolean }) {
  return (
    <span style={{ fontSize: 13, color: isPublished ? "#0a7" : "#999" }}>
      {isPublished ? "published" : "pending"}
    </span>
  );
}
