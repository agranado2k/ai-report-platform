import { parseBody, splitShell } from "arp-report-html";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import EditReport from "./app/routes/$slug_.edit";

const raw = document.getElementById("report-src")?.textContent ?? "";
const { shell, bodyHtml } = splitShell(raw);
const versions = [2, 1].map((n) => ({
  id: String(n),
  version_no: n,
  uploaded_at: "2026-09-01T12:00:00Z",
  uploaded_by: "fixture",
  scan_status: "clean",
  author: { name: "Editor", email: "editor@example.test" },
}));
const data = {
  doc: parseBody(bodyHtml),
  shell,
  slug: "mobile-report",
  appOrigin: "https://app.example.test",
  editToken: "fixture-only",
  editTokenExp: Math.floor(Date.now() / 1000) + 3600,
  docTitle: "Mobile editing report",
  versionId: "2",
  comments: [],
  versions,
  commentsHasMore: false,
  versionsHasMore: false,
};
const router = createMemoryRouter([{ path: "/", loader: () => data, element: <EditReport /> }]);
createRoot(document.getElementById("root") as HTMLElement).render(
  <RouterProvider router={router} />,
);
