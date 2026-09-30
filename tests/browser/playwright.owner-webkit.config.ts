import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Supplementary engine coverage; the default CI browser tier remains Chromium.
export default defineConfig({
  ...base,
  projects: base.projects
    ?.filter((project) => ["owner-view-chrome", "owner-view-lossy"].includes(project.name ?? ""))
    .map((project) => ({
      ...project,
      name: `${project.name}-webkit`,
      use: { ...project.use, browserName: "webkit" },
    })),
});
