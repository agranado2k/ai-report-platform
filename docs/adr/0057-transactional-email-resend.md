# ADR-0057: Transactional email via Resend (the allowlist magic link)

- **Status**: Accepted
- **Date**: 2026-06-26
- **Deciders**: agranado2k
- **Relates to**: ADR-0056 (report sharing & ACLs — the `allowlist` mode needs to email a magic link), ADR-017 (everything-as-code), ADR-0020 (ports & adapters), ADR-019 (infra-first).

## Context and problem statement

The `allowlist` sharing mode (ADR-0056) proves a viewer owns an allowlisted email by sending them a one-time **magic link**. The platform had **no email-sending capability** in code — only a `modules/resend-domain` Terraform module that verifies the **apex domain** with Resend (DKIM/SPF records in the Cloudflare zone) and a `RESEND_API_KEY` already held as a CI secret. We need a runtime path for the app to actually send a transactional email.

## Decision drivers

- One transactional template (the magic link) — keep it simple, no heavyweight email stack.
- Reuse what exists: the apex domain + DKIM are already Terraform-managed and the `RESEND_API_KEY` secret already exists.
- Everything-as-code (ADR-017) + ports & adapters (ADR-0020) + fail-open on missing config (the platform pattern).

## Decision outcome

**Send transactional email through Resend**, via a small hexagonal port + adapter:

- **`EmailSender` port** (`packages/application`) — `send({ to, subject, html, text? }) → Result<void, AppError>`. Use cases depend on the port and are tested with a capturing `FakeEmailSender`.
- **`ResendEmailSender` adapter** (`packages/adapters`) — a plain `fetch` POST to `https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>`. **No SDK dependency** (one endpoint; `fetchImpl` is injectable for unit tests). Any non-2xx or network error maps to a `Result` error — it never throws.
- **Config** — `RESEND_API_KEY` (secret) + `EMAIL_FROM` (`noreply@<apex>`, the Resend-verified apex domain) provisioned onto the **app** Vercel project (production + preview) by Terraform. **Fail-open**: when `RESEND_API_KEY` is unset, no `EmailSender` is wired and the allowlist send-link path stays inert (it still returns the generic "if your email is on the list…" — privacy-preserving), so the apply never breaks on a not-yet-provisioned key.

## Considered options

- **Resend** *(chosen)* — modern HTTP API (one endpoint), the apex domain + DKIM are already Terraform-managed (`modules/resend-domain`), and the `RESEND_API_KEY` secret already exists. Lowest-friction for a single transactional template.
- **AWS SES** (rejected — heavier IAM/sandbox setup, clunkier DX; overkill for one magic-link template).
- **Postmark** (rejected — another vendor evaluation; no existing setup).

## Consequences

- **Good:** no new runtime dependency (plain `fetch`); the domain/DKIM infra already exists; the port keeps use cases testable + vendor-swappable; fail-open means partial provisioning never breaks the app.
- **Trade-offs:** a new outbound network dependency on Resend at send time (handled as a `Result` error, not a throw — the send-link action stays generic regardless); email deliverability now depends on the Resend domain staying verified.

## More information

This ADR lands with the `EmailSender` port + `ResendEmailSender` adapter + the `RESEND_API_KEY`/`EMAIL_FROM` Terraform wiring (the allowlist phase, PRD #109 slice 2). The magic-link template + the send/redeem use cases land in the following slices. Glossary: `EmailSender`.
