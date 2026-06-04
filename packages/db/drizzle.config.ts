import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` reads only the schema (no DB connection); the URL is
// only used by `migrate`/`push`, which run in CI against the Neon branch
// (ADR-019). Column names are explicit snake_case in the schema, so no casing
// transform is configured here.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
