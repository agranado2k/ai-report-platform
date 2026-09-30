// Mounts the PRODUCTION app shell and dashboard body (ADR-0079, app-component
// amendment; #403): `AppShell` exactly as the `_app` layout renders it, and
// `DashboardPage` exactly as the `_app._index` route renders it, under a
// react-router memory data router. Bundled by build-app.mts against apps/app,
// with the app's compiled stylesheet.
//
// What is NOT production here, named so nobody mistakes it: the data. The
// route loaders (Clerk, Neon, the use cases) are replaced by the fixture below,
// reduced the way the loaders reduce it — `?folder=` is honoured only when the
// Folder exists, `?q=` filters by title. The account slot is a plain button
// (Clerk's <UserButton> needs a live Clerk frontend API, which is the e2e
// tier's). `/upload` and `/settings/api-keys` render a placeholder body: they
// exist as navigation DESTINATIONS here, not as pages under test.
//
// Scenarios come from the page's own query string, so one built page serves
// every spec: `?list=default|empty|processing` picks the Reports,
// `?paged=1` turns on both cursor links, and `?path=` is the initial route.
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router-dom";
import {
  type DashboardFolder,
  DashboardPage,
  type DashboardReport,
} from "./app/components/reports/DashboardPage";
import { AppShell } from "./app/components/shell/AppShell";

const params = new URLSearchParams(window.location.search);

const LONG_FOLDER = "Quarterly customer research synthesis for the enterprise onboarding programme";
const LONG_TITLE =
  "An exceptionally long Report title that describes the Q3 enterprise onboarding research synthesis in full detail";

const badge = { label: "Org", tone: "brand" as const, title: "Visible to the organisation" };
const folders: DashboardFolder[] = [
  {
    id: "fold_root",
    parentId: null,
    name: "Root",
    visibility: "org",
    isRoot: true,
    manageable: false,
    blockedReason: null,
    badge,
  },
  {
    id: "fold_research",
    parentId: "fold_root",
    name: LONG_FOLDER,
    visibility: "org",
    isRoot: false,
    manageable: true,
    blockedReason: null,
    badge,
  },
  {
    id: "fold_design",
    parentId: "fold_research",
    name: "Design reviews",
    visibility: "private",
    isRoot: false,
    manageable: true,
    blockedReason: null,
    badge: { label: "Private", tone: "neutral", title: "Only you" },
  },
];

const sharing = (slug: string, title: string, label = "Private") => ({
  slug,
  title,
  badge: { label, tone: "neutral", title: `${label} sharing` },
  manageable: true,
  blockedReason: null,
  state: "private",
  discardWarning: null,
  formKey: `k-${slug}`,
});

function report(n: number, title: string, over: Partial<DashboardReport> = {}): DashboardReport {
  const slug = `slug${String(n).padStart(6, "0")}`;
  return {
    id: `report_${n}`,
    slug,
    title,
    isPublished: true,
    folderId: "fold_research",
    displayFolderId: "fold_research",
    editabilityNotice: null,
    fidelityNotice: null,
    sharing: sharing(slug, title),
    ...over,
  };
}

const DEFAULT_REPORTS: DashboardReport[] = [
  report(1, LONG_TITLE),
  report(2, "Q3 roadmap review", {
    folderId: "fold_root",
    displayFolderId: "fold_root",
    fidelityNotice: { label: "Saving drops scripts", title: "A save would drop <script>" },
    sharing: sharing("slug000002", "Q3 roadmap review", "Org"),
  }),
  report(3, "Pricing experiment (uploading)", { isPublished: false }),
  report(4, "Legacy dashboard export", {
    editabilityNotice: { label: "Can't edit", title: "The editor cannot open this Report" },
  }),
  report(5, "Design critique notes", { folderId: "fold_design", displayFolderId: "fold_design" }),
];

const LISTS: Record<string, DashboardReport[]> = {
  default: DEFAULT_REPORTS,
  empty: [],
  processing: [report(9, "Freshly uploaded Report", { isPublished: false })],
};

/** The loader's reduction of the URL, over the fixture. */
function dashboardData(search: string) {
  const sp = new URLSearchParams(search);
  const q = sp.get("q")?.trim() ?? "";
  const requested = sp.get("folder") ?? "";
  const selectedFolderId = folders.some((f) => f.id === requested) ? requested : null;
  const all = LISTS[params.get("list") ?? "default"] ?? DEFAULT_REPORTS;
  const items = all.filter(
    (r) =>
      (!q || r.title.toLowerCase().includes(q.toLowerCase())) &&
      (!selectedFolderId || r.folderId === selectedFolderId),
  );
  const paged = params.get("paged") === "1";
  return { q, selectedFolderId, items, hasPrev: paged, hasNext: paged };
}

function Dashboard() {
  const location = useLocation();
  const data = dashboardData(location.search);
  return (
    <DashboardPage
      folders={folders}
      rootId="fold_root"
      inertShareNotice="Sharing has no effect on an org-visible folder."
      rosterUnavailableNotice="The share list could not be loaded."
      personShareLimitNotice="Folders can be shared with at most 50 people."
      sharingChoices={[
        { value: "private", label: "Private", hint: "Only you" },
        { value: "org_view", label: "Organisation can view", hint: "Everyone in your org" },
      ]}
      reportOutcome={null}
      newFolderError={null}
      {...data}
    />
  );
}

/** The `_app` layout's use of the shell, minus Clerk, the palette and toasts. */
function Layout() {
  const location = useLocation();
  return (
    <AppShell
      navFolders={folders.map(({ id, parentId, name }) => ({ id, parentId, name }))}
      activePath={location.pathname}
      selectedFolderId={new URLSearchParams(location.search).get("folder")}
      account={
        <button type="button" className="size-7 rounded-full bg-brand text-on-brand text-xs">
          AG
        </button>
      }
    >
      <Outlet />
    </AppShell>
  );
}

const placeholder = (title: string) => () => (
  <main className="p-6">
    <h1>{title}</h1>
  </main>
);

const router = createMemoryRouter(
  [
    {
      path: "/",
      element: <Layout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: "upload", Component: placeholder("Upload page") },
        { path: "settings/api-keys", Component: placeholder("API keys page") },
      ],
    },
  ],
  { initialEntries: [params.get("path") ?? "/"] },
);

/** The router's current location, for specs asserting that state survived. */
(window as unknown as { harnessLocation: () => string }).harnessLocation = () =>
  `${router.state.location.pathname}${router.state.location.search}`;

createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />,
);
