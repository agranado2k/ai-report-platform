import { type APIResponse, expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { When, Then } = createBdd();

// Single-scenario smoke; workers: 1 in the config makes a module-level capture
// safe. Uses the `request` fixture (no browser needed) against use.baseURL.
let response: APIResponse;

When('I GET {string} on the app', async ({ request }, path: string) => {
  response = await request.get(path);
});

Then('the response status is {int}', async ({}, status: number) => {
  expect(response.status()).toBe(status);
});

Then('the JSON field {string} is {string}', async ({}, field: string, value: string) => {
  const body = (await response.json()) as Record<string, unknown>;
  expect(body[field]).toBe(value);
});
