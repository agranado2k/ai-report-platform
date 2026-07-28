// The in-viewer editor's Save-fetch helper (ADR-0063 Phase 4). Cross-origin
// (view.<domain> → app.<domain>), Bearer-only: the edit token IS the
// credential, so `credentials: "omit"` is load-bearing — no cookie ever rides
// along, matching the #183 CORS layer's posture (Access-Control-Allow-
// Credentials is never set on that route; see docs/adr/0063-*.md and the
// diary's "Edit-token API acceptance seam" entry). A 401/403 means the token
// is no longer valid (expired, or the underlying write grant was revoked
// server-side — reassembleAndSaveEditedVersion re-checks `canWrite` live on
// every save) — both collapse to the same "reopen from the dashboard"
// message, since there is nothing the in-viewer client can do to recover
// either case (no session to refresh; a new token can only be minted from
// app.<domain>).
import type { PMDocJson } from "arp-report-html";

export interface SaveEditInput {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  readonly doc: PMDocJson;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export type SaveEditResult =
  | { readonly ok: true; readonly version: number; readonly scanStatus: string }
  | { readonly ok: false; readonly expired: boolean; readonly message: string };

interface SaveEditedVersionResponseBody {
  readonly version?: number;
  readonly scan_status?: string;
}

const EXPIRED_MESSAGE = "Your editing session has expired — reopen this report from the dashboard.";

export async function saveEdit(input: SaveEditInput): Promise<SaveEditResult> {
  const fetchImpl = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${input.appOrigin}/api/v1/reports/${input.slug}/versions`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.editToken}`,
      },
      body: JSON.stringify({ doc: input.doc }),
    });
  } catch {
    return {
      ok: false,
      expired: false,
      message: "Network error — check your connection and try again.",
    };
  }

  // The edit token's own validity failed, OR it's live-valid but the
  // underlying write grant was just revoked (reassembleAndSaveEditedVersion's
  // server-side canWrite re-check, ADR-0063 §3/§5) — both surface as 401/403
  // here and are indistinguishable (and irrecoverable) from this client.
  if (response.status === 401 || response.status === 403) {
    return { ok: false, expired: true, message: EXPIRED_MESSAGE };
  }

  if (!response.ok) {
    return { ok: false, expired: false, message: `Save failed (${response.status}).` };
  }

  const body = (await response.json()) as SaveEditedVersionResponseBody;
  return {
    ok: true,
    version: body.version ?? 0,
    scanStatus: body.scan_status ?? "pending",
  };
}
