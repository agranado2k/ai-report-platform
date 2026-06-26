// The platform's environment contract (Phase 1 surface). Split into server-only
// secrets and client-safe PUBLIC_ vars so @t3-oss/env-core can guarantee a
// secret never reaches the browser bundle. Grows as later phases add vars.
import { z } from "zod";
import { trimmedString } from "./schema-helpers";

/** Server-only — secrets + infra. NEVER bundled to the client. */
export const serverSchema = {
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Neon Postgres connection string (Reports & Folders persistence, ADR-020).
  DATABASE_URL: z.url(),

  // Async scan pipeline (ADR-0045). Shared secret the Cloudflare cron Worker
  // presents to POST /internal/scan-drain. OPTIONAL at the env layer (it's
  // provisioned by Terraform independently of the code deploy, so the app must
  // boot without it) — the drain route itself is fail-closed: it returns 503
  // when this is unset and 401 on a mismatch.
  SCAN_DRAIN_SECRET: trimmedString.optional(),
  // pg-boss connection string (node-postgres TCP). Defaults to DATABASE_URL when
  // unset; set it to Neon's POOLED endpoint so the drain doesn't exhaust
  // connections under serverless cold starts. Optional.
  SCAN_QUEUE_DATABASE_URL: z.url().optional(),

  // Cloudflare R2 (blob storage, ADR-0004).
  R2_ACCOUNT_ID: trimmedString,
  R2_ACCESS_KEY_ID: trimmedString,
  R2_SECRET_ACCESS_KEY: trimmedString,
  R2_BUCKET: trimmedString,
  // Optional R2 key namespace (e.g. "pr-42/") that isolates a preview
  // deployment's blobs within the shared bucket (preview-data-isolation). Unset
  // in production, so prod keys stay at `reports/…`.
  R2_KEY_PREFIX: trimmedString.optional(),

  // Clerk server key (ADR-0005). The publishable key is client-safe — see below.
  CLERK_SECRET_KEY: trimmedString,

  // Clerk webhook signing secret (ADR-0054) — verifies inbound `user.deleted` events
  // (Standard Webhooks / Svix scheme, via @clerk/backend's verifyWebhook). OPTIONAL at
  // the env layer like API_KEY_PEPPER: Terraform/Clerk provision it out-of-band, so the
  // app boots without it. The webhook route fails CLOSED when it's unset (503), so the
  // endpoint is simply inert until the secret + Clerk endpoint are configured.
  CLERK_WEBHOOK_SIGNING_SECRET: trimmedString.optional(),

  // API-key auth (ADR-0008). Server-side HMAC pepper used to hash `arp_` keys, so
  // a DB-only leak can't verify guesses. OPTIONAL at the env layer (Terraform
  // provisions it independently of the code deploy, so the app boots without it):
  // the ApiKeyService fails CLOSED when it's unset — minting throws and every key
  // verification returns false, so the `arp_` Bearer path is simply inert until
  // the secret lands. Clerk-session auth is unaffected.
  API_KEY_PEPPER: trimmedString.optional(),
  // Environment label stamped into minted keys (`arp_live_…` vs `arp_test_…`).
  // Terraform sets `live` on prod, `test` on previews/dev. Defaults to `test` so a
  // misconfigured env never mints a `live`-looking key.
  API_KEY_ENV: z.enum(["live", "test"]).default("test"),

  // Upstash rate-limiting (ADR-0011) — wired in Phase 1.5, so optional for now.
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: trimmedString.optional(),

  // Canonical viewer origin, e.g. "https://view.example" (ADR-002 / ADR-0038).
  // The upload API builds `view_url = ${VIEW_ORIGIN}/${slug}` from it. OPTIONAL:
  // Terraform sets it only on the production target, so previews/dev fall back to
  // the request origin (the cross-origin serve is then prod-only).
  VIEW_ORIGIN: z.url().optional(),

  // Canonical app origin, e.g. "https://app.example" (ADR-0056). The viewer
  // redirects a private report to `${APP_ORIGIN}/unlock/${slug}` to authorize.
  // OPTIONAL: set on prod; previews/dev fall back to the request origin.
  APP_ORIGIN: z.url().optional(),

  // Shared HMAC secret for the app↔view access token (ADR-0056). The app mints,
  // the credential-free viewer verifies. OPTIONAL: when unset, private-report
  // gating is inert (no token can be minted/verified) — the upload/set_acl path
  // still works; enforcement just can't engage until the secret is provisioned.
  VIEW_ACCESS_TOKEN_SECRET: trimmedString.optional(),

  // Transactional email via Resend (ADR-0057) — the allowlist magic link. OPTIONAL:
  // unset ⇒ no EmailSender is wired, so the allowlist send-link path stays inert
  // (returns the generic "if your email is on the list…" without actually sending).
  RESEND_API_KEY: trimmedString.optional(),
  // The verified From address, e.g. "noreply@<apex>" (the Resend-verified apex; DKIM/SPF set, ADR-0057).
  EMAIL_FROM: trimmedString.optional(),
} as const;

/**
 * Client-safe vars. Must carry the PUBLIC_ prefix (enforced by clientPrefix at
 * type + runtime). More land in VS-3 when the apps read public vars in-browser.
 */
export const clientSchema = {
  PUBLIC_CLERK_PUBLISHABLE_KEY: trimmedString,
} as const;
