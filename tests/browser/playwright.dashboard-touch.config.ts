import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Optional local matrix; CI retains the default Chromium project.
export default defineConfig({
  ...base,
  testMatch: "dashboard-mobile.spec.ts",
  projects: [
    { name: "dashboard-chromium-touch", use: { browserName: "chromium", hasTouch: true } },
    { name: "dashboard-webkit-touch", use: { browserName: "webkit", hasTouch: true } },
  ],
});
