// ResendEmailSender — the EmailSender port (ADR-0057) over Resend's HTTP API. Plain
// `fetch` (no SDK dependency); `fetchImpl` is injectable for unit tests. Used for the
// `allowlist` magic link (ADR-0056). Fail-safe: any non-2xx / network error → a Result
// error (never throws), so the caller can decide (e.g. the send action stays generic).
import type { EmailMessage, EmailSender } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendOptions {
  /** Resend API key (`re_…`). */
  readonly apiKey: string;
  /** The verified From address, e.g. `noreply@mail.<apex>` (DKIM/SPF set, ADR-0057). */
  readonly from: string;
  /** Injectable fetch for tests; defaults to the global. */
  readonly fetchImpl?: typeof fetch;
}

export class ResendEmailSender implements EmailSender {
  constructor(private readonly opts: ResendOptions) {}

  async send(message: EmailMessage): Promise<Result<void, AppError>> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    try {
      const res = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: this.opts.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return err({
          kind: "Unexpected",
          message: `resend send failed: ${res.status} ${detail.slice(0, 200)}`,
        });
      }
      return ok(undefined);
    } catch (e) {
      return err({ kind: "Unexpected", message: `resend send error: ${String(e)}` });
    }
  }
}
