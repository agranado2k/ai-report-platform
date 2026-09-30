import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppHeader } from "../../../apps/app/app/components/AppHeader";
import { PageShell } from "../../../apps/app/app/components/PageShell";
import { ReportFilter } from "../../../apps/app/app/components/reports/ReportFilter";
import { ReportRow } from "../../../apps/app/app/components/reports/ReportRow";
import { AppShell } from "../../../apps/app/app/components/shell/AppShell";

const folders = [
  { id: "root", parentId: null, name: "Root" },
  {
    id: "research",
    parentId: "root",
    name: "Research and product strategy with an exceptionally long folder name",
  },
];
const report = {
  slug: "abc123",
  title: "Quarterly research and product strategy report",
  isPublished: true,
  folderId: "root",
  displayFolderId: "root",
  editabilityNotice: null,
  fidelityNotice: null,
  sharing: {
    slug: "abc123",
    title: "Quarterly research",
    badge: { label: "Private", tone: "neutral", title: "Only you" },
    manageable: false,
    blockedReason: "Only the owner can change sharing",
    state: "private",
    discardWarning: null,
    formKey: "private",
  },
};

function Dashboard() {
  return (
    <AppShell
      navFolders={folders}
      activePath="/"
      selectedFolderId="research"
      account={<button type="button">Account</button>}
    >
      <PageShell>
        <AppHeader title="Your reports" />
        <div className="mb-6 flex items-center gap-2">
          <ReportFilter defaultQuery="" />
        </div>
        <ul className="rounded-card border border-border bg-surface shadow-xs">
          <ReportRow
            report={report}
            folders={folders}
            folderLabel="Research and product strategy with an exceptionally long folder name"
            sharingChoices={[]}
            pendingSharing={null}
          />
        </ul>
        <nav aria-label="Report pages" className="mt-4 flex gap-3 text-sm">
          <span className="text-subtle">← Prev</span>
          <a href="/?starting_after=abc123">Next →</a>
        </nav>
      </PageShell>
    </AppShell>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={createMemoryRouter([{ path: "*", element: <Dashboard /> }])} />,
);
