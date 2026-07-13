// The in-viewer editor's Versions tab (unified-experience epic, ADR-0065):
// lists a report's version history (author + timestamp, per the
// `ReportVersionSummary` wire projection) and lets the user pick two
// versions to Compare. The list itself was loaded server-side by the
// `/<slug>/edit` route's loader (Bearer, no CORS) — this component never
// fetches it. Compare is a CLIENT-side cross-origin fetch
// (../diff-client.ts) — the resulting diff is handed to the parent via
// `onCompare`, which is responsible for rendering it through the sandboxed
// `SandboxedHtml` (F-1) — this component never touches the diff HTML.
import { Badge, Button, Select } from "arp-ui";
import { useState } from "react";
import { authorInitials, relativeTime } from "../comment-format";
import { getDiff } from "../diff-client";
import type { DiffWire, VersionWire } from "../wire-types";

export interface VersionsPanelProps {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  readonly versions: readonly VersionWire[];
  readonly onCompare: (diff: DiffWire) => void;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** The human label for a version's uploader (ADR-0063 author display): the
 *  display NAME when stored, else the resolved email, else a stable "Unknown
 *  user" fallback — never the raw `user_…` id (`uploaded_by`) that used to
 *  render here. */
export function versionAuthorLabel(v: Pick<VersionWire, "author">): string {
  return v.author?.name ?? v.author?.email ?? "Unknown user";
}

/** A small circular initials avatar for a version's uploader (ADR-0063 author
 *  display) — mirrors the Comments panel. Initials come from the display name
 *  when present, else the email local-part; `?` when neither. Decorative — the
 *  name/email is rendered as text beside it. */
function Avatar({ name, email }: { readonly name: string | null; readonly email: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 select-none items-center justify-center rounded-full bg-surface-raised text-[9px] font-semibold text-subtle"
    >
      {authorInitials(name, email)}
    </span>
  );
}

function scanBadge(status: string) {
  if (status === "clean") return <Badge tone="success">clean</Badge>;
  if (status === "pending") return <Badge tone="neutral">pending</Badge>;
  return <Badge tone="danger">{status}</Badge>;
}

export function VersionsPanel({
  appOrigin,
  slug,
  editToken,
  versions,
  onCompare,
}: VersionsPanelProps) {
  const sorted = [...versions].sort((a, b) => b.version_no - a.version_no);
  const [fromId, setFromId] = useState(sorted[1]?.id ?? "");
  const [toId, setToId] = useState(sorted[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compare = async () => {
    if (!fromId || !toId || fromId === toId) return;
    setBusy(true);
    setError(null);
    const result = await getDiff({
      appOrigin,
      slug,
      editToken,
      fromVersionId: fromId,
      toVersionId: toId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onCompare(result.diff);
  };

  if (sorted.length === 0) {
    return <p className="text-sm text-muted">No version history yet.</p>;
  }

  return (
    <section className="flex w-full flex-col gap-3" aria-label="Versions">
      <div className="flex flex-col gap-2 rounded-control border border-border p-3">
        <p className="text-xs font-medium text-fg">Compare versions</p>
        <label className="text-xs text-subtle" htmlFor="diff-from">
          From
        </label>
        <Select id="diff-from" size="sm" value={fromId} onChange={(e) => setFromId(e.target.value)}>
          {sorted.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version_no} — {formatTimestamp(v.uploaded_at)}
            </option>
          ))}
        </Select>
        <label className="text-xs text-subtle" htmlFor="diff-to">
          To
        </label>
        <Select id="diff-to" size="sm" value={toId} onChange={(e) => setToId(e.target.value)}>
          {sorted.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version_no} — {formatTimestamp(v.uploaded_at)}
            </option>
          ))}
        </Select>
        {error ? (
          <p className="text-xs text-danger" role="alert">
            ✗ {error}
          </p>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={compare}
          disabled={busy || !fromId || !toId || fromId === toId}
        >
          {busy ? "Comparing…" : "Compare"}
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {sorted.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between rounded-control border border-border p-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Avatar name={v.author?.name ?? null} email={v.author?.email ?? null} />
              <div className="min-w-0">
                <p className="font-medium text-fg">v{v.version_no}</p>
                <p className="truncate text-xs text-subtle">
                  {versionAuthorLabel(v)} ·{" "}
                  <span title={formatTimestamp(v.uploaded_at)}>{relativeTime(v.uploaded_at)}</span>{" "}
                  · {v.origin}
                </p>
              </div>
            </div>
            {scanBadge(v.scan_status)}
          </li>
        ))}
      </ul>
    </section>
  );
}
