import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

// Distinct step phrasing from the other smoke files so the global registry has no
// clashes. Module state is safe under workers: 1 (see playwright.config.ts).
let res: APIResponse;

When("I request {string} without following redirects", async ({ request }, path: string) => {
  res = await request.get(path, { maxRedirects: 0 });
});

Then("the gate status is {int}", async ({}, status: number) => {
  expect(res.status()).toBe(status);
});

Then("the gate redirects to {string}", async ({}, location: string) => {
  expect(res.headers().location ?? "").toContain(location);
});
