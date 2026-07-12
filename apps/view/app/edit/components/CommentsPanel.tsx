// The in-viewer editor's Comments tab (unified-experience epic, ADR-0064).
// Modeled on apps/app/app/components/CommentSidebar.tsx's structure
// (composer + threads + resolve) but adapted to this app's constraints:
// CROSS-ORIGIN `fetch` calls carrying the edit token as `Authorization:
// Bearer` (../comments-client.ts), NOT Remix `useFetcher`/same-origin
// resource-route actions (there is no such route on this origin — every
// write goes straight to the app-origin REST API). Comment bodies are
// rendered as plain React text (auto-escaped) — never `dangerouslySetInnerHTML` —
// they are untrusted user input.
//
// State management: no Remix fetcher revalidation is available cross-origin,
// so mutations update the parent's `comments` list directly (optimistic
// append/replace) rather than triggering a full list refetch — one fewer
// network round-trip, and no window where a failed refetch would silently
// leave a stale list after a successful write.
// TYPE-ONLY import (erased at build): pulling a VALUE from the `arp-domain`
// barrel drags its `node:crypto`-using modules (signed-token) into this browser
// bundle and breaks the Vite/Rollup build. The `Intent` type costs nothing at
// runtime, and `Record<Intent, …>` below still gives us drift-safety.
import type { Intent } from "arp-domain";
import { buildSelectionAnchor, type EditorSelection } from "arp-editor";
import { Badge, Button, Card, Select, Textarea } from "arp-ui";
import { useState } from "react";
import { initialsFromEmail, relativeTime } from "../comment-format";
import { addComment, replyToComment, resolveComment } from "../comments-client";
import type { CommentWire } from "../wire-types";

export interface CommentsPanelProps {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  /** The version id (wire-encoded) currently open in the editor — every NEW
   *  comment/reply anchors to it (version-pinned fallback, always
   *  populated). */
  readonly currentVersionId: string;
  readonly comments: readonly CommentWire[];
  readonly onCommentsChange: (comments: readonly CommentWire[]) => void;
  /** The editor's current non-empty selection, or `null` — gates whether the
   *  "new comment" composer renders at all (only present while `mode ===
   *  "edit"`, since selection tracking requires the mounted ReportEditor). */
  readonly pendingSelection: EditorSelection | null;
  /** Called once the composer's add-comment POST resolves SUCCESSFULLY —
   *  never on failure, so a failed post leaves the composer mounted with its
   *  typed body and error visible (mirrors CommentSidebar's PR #157 fix). */
  readonly onSelectionConsumed: () => void;
}

/** The human label for a comment's author (ADR-0063 author display): the
 *  resolved email when available, else a stable "Unknown user" fallback for a
 *  deleted/never-mirrored author — never the raw `user_…` id, which is exactly
 *  what this replaced. */
export function authorLabel(c: Pick<CommentWire, "author">): string {
  return c.author?.email ?? "Unknown user";
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Human-facing labels for each intent value. The VALUES themselves are
 *  derived from the domain's `COMMENT_INTENTS` (below) so a new intent added
 *  to the enum can't leave the composer out of sync; this map only carries the
 *  display text. A value missing a label falls back to the value itself. */
/** Human-facing labels, keyed by the domain `Intent` union. Typed as
 *  `Record<Intent, string>` so it stays EXHAUSTIVE at compile time: adding a
 *  fifth member to the domain enum breaks the build here until it gets a label
 *  — the same drift-safety a runtime `COMMENT_INTENTS` import would give, but
 *  without dragging the domain barrel (and its `node:crypto` deps) into the
 *  browser bundle. */
const INTENT_LABELS: Record<Intent, string> = {
  note: "Note",
  enhancement: "Enhance",
  add: "Add",
  remove: "Remove",
};

/** The comment-intent options surfaced in the composer (ADR-0064 Decision 8),
 *  derived from the exhaustive label map so they never drift. `note` is the
 *  default; the value is the wire enum, the label is human-facing. */
const INTENT_OPTIONS: readonly { readonly value: Intent; readonly label: string }[] = (
  Object.keys(INTENT_LABELS) as Intent[]
).map((value) => ({ value, label: INTENT_LABELS[value] }));

function ErrorText({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-xs text-danger" role="alert">
      ✗ {message}
    </p>
  );
}

/** A small circular initials avatar (comment-display-polish). Only the email
 *  is available (no display-name), so initials come from its local-part; `?`
 *  when absent. Decorative — the author's email is rendered as text right
 *  beside it, so the avatar is `aria-hidden`. */
function Avatar({ email }: { readonly email: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 select-none items-center justify-center rounded-full bg-surface-raised text-[9px] font-semibold text-subtle"
    >
      {initialsFromEmail(email)}
    </span>
  );
}

/** The comment's intent as a chip (comment-display-polish). `note` is the
 *  common default — kept calm by omitting the chip entirely; every other intent
 *  gets a visible `brand` badge with its human label. `intent` is a bounded
 *  enum on the wire (typed `string`); the label lookup falls back to the raw
 *  value, and React auto-escapes it either way. */
function IntentChip({ intent }: { readonly intent: string }) {
  if (intent === "note") return null;
  const label = INTENT_LABELS[intent as Intent] ?? intent;
  return (
    <Badge tone="brand" className="text-[10px]">
      {label}
    </Badge>
  );
}

function NewCommentComposer({
  appOrigin,
  slug,
  editToken,
  versionId,
  selection,
  comments,
  onCommentsChange,
  onSubmitted,
}: {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  readonly versionId: string;
  readonly selection: EditorSelection;
  readonly comments: readonly CommentWire[];
  readonly onCommentsChange: (comments: readonly CommentWire[]) => void;
  readonly onSubmitted: () => void;
}) {
  const [body, setBody] = useState("");
  const [intent, setIntent] = useState("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const anchor = buildSelectionAnchor({
      versionId,
      from: selection.from,
      to: selection.to,
      text: selection.text,
    });
    const result = await addComment({
      appOrigin,
      slug,
      editToken,
      body,
      intent,
      anchor: {
        versionId: anchor.versionId,
        textQuote: anchor.textQuote,
        relative: anchor.relative,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setBody("");
    setIntent("note");
    onCommentsChange([...comments, result.comment]);
    onSubmitted();
  };

  return (
    <Card className="mb-4 p-3">
      <p className="mb-2 text-xs text-subtle">
        Commenting on: <span className="italic text-muted">"{selection.text.slice(0, 80)}"</span>
      </p>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        rows={3}
        className="w-full"
      />
      <ErrorText message={error} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-subtle">
          <span id="comment-intent-label">Intent</span>
          <Select
            size="sm"
            aria-labelledby="comment-intent-label"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={busy}
          >
            {INTENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onSubmitted} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={busy || !body.trim()}>
            {busy ? "Posting…" : "Comment"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CommentThread({
  appOrigin,
  slug,
  editToken,
  root,
  replies,
  comments,
  onCommentsChange,
}: {
  readonly appOrigin: string;
  readonly slug: string;
  readonly editToken: string;
  readonly root: CommentWire;
  readonly replies: readonly CommentWire[];
  readonly comments: readonly CommentWire[];
  readonly onCommentsChange: (comments: readonly CommentWire[]) => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyIntent, setReplyIntent] = useState("note");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const submitReply = async () => {
    if (!replyBody.trim()) return;
    setReplyBusy(true);
    setReplyError(null);
    // A reply anchors to the SAME location as its root — no fresh selection
    // needed to reply (only the root comment is created off a selection).
    const result = await replyToComment({
      appOrigin,
      slug,
      editToken,
      parentCommentId: root.id,
      body: replyBody,
      intent: replyIntent,
      anchor: {
        versionId: root.anchor.version_pinned.version_id,
        textQuote: root.anchor.version_pinned.text_quote,
        relative: root.anchor.relative,
      },
    });
    setReplyBusy(false);
    if (!result.ok) {
      setReplyError(result.message);
      return;
    }
    setReplyBody("");
    setReplyIntent("note");
    setReplyOpen(false);
    onCommentsChange([...comments, result.comment]);
  };

  const resolve = async () => {
    setResolveBusy(true);
    setResolveError(null);
    const result = await resolveComment({ appOrigin, slug, editToken, commentId: root.id });
    setResolveBusy(false);
    if (!result.ok) {
      setResolveError(result.message);
      return;
    }
    onCommentsChange(comments.map((c) => (c.id === result.comment.id ? result.comment : c)));
  };

  return (
    <Card className="mb-3 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Avatar email={root.author?.email ?? null} />
          <span className="truncate text-xs font-medium text-fg">{authorLabel(root)}</span>
          <IntentChip intent={root.intent} />
        </div>
        {root.resolved_at ? (
          <Badge tone="success">Resolved</Badge>
        ) : (
          <Badge tone="neutral">Open</Badge>
        )}
      </div>
      <p className="mb-1 text-xs italic text-subtle">
        "{root.anchor.version_pinned.text_quote.slice(0, 80)}"
      </p>
      <p className="text-sm text-fg">{root.body}</p>
      <p className="mt-1 text-[10px] text-subtle" title={formatTimestamp(root.created_at)}>
        {relativeTime(root.created_at)}
      </p>

      {replies.map((reply) => (
        <div key={reply.id} className="mt-2 border-l border-border pl-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Avatar email={reply.author?.email ?? null} />
              <span className="truncate text-xs font-medium text-fg">{authorLabel(reply)}</span>
              <IntentChip intent={reply.intent} />
            </div>
            <span className="text-[10px] text-subtle" title={formatTimestamp(reply.created_at)}>
              {relativeTime(reply.created_at)}
            </span>
          </div>
          <p className="text-sm text-fg">{reply.body}</p>
        </div>
      ))}

      <ErrorText message={resolveError} />
      <ErrorText message={replyError} />

      {replyOpen ? (
        <div className="mt-2">
          <Textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Reply…"
            rows={2}
            className="w-full"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-xs text-subtle">
              <span id={`reply-intent-label-${root.id}`}>Intent</span>
              <Select
                size="sm"
                aria-labelledby={`reply-intent-label-${root.id}`}
                value={replyIntent}
                onChange={(e) => setReplyIntent(e.target.value)}
                disabled={replyBusy}
              >
                {INTENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setReplyOpen(false)}
                disabled={replyBusy}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={submitReply}
                disabled={replyBusy || !replyBody.trim()}
              >
                {replyBusy ? "Posting…" : "Reply"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setReplyOpen(true)}>
            Reply
          </Button>
          {root.resolved_at ? null : (
            <Button variant="ghost" size="sm" onClick={resolve} disabled={resolveBusy}>
              {resolveBusy ? "Resolving…" : "Resolve"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function CommentsPanel({
  appOrigin,
  slug,
  editToken,
  currentVersionId,
  comments,
  onCommentsChange,
  pendingSelection,
  onSelectionConsumed,
}: CommentsPanelProps) {
  const roots = comments.filter((c) => c.parent_id === null);
  const repliesByRoot = new Map<string, CommentWire[]>();
  for (const c of comments) {
    if (c.parent_id === null) continue;
    const list = repliesByRoot.get(c.parent_id) ?? [];
    list.push(c);
    repliesByRoot.set(c.parent_id, list);
  }
  const sortedRoots = [...roots].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <section className="flex w-full flex-col gap-2" aria-label="Comments">
      {pendingSelection ? (
        <NewCommentComposer
          appOrigin={appOrigin}
          slug={slug}
          editToken={editToken}
          versionId={currentVersionId}
          selection={pendingSelection}
          comments={comments}
          onCommentsChange={onCommentsChange}
          onSubmitted={onSelectionConsumed}
        />
      ) : (
        <p className="mb-2 text-xs text-subtle">Select text in the document to add a comment.</p>
      )}

      {sortedRoots.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        sortedRoots.map((root) => (
          <CommentThread
            key={root.id}
            appOrigin={appOrigin}
            slug={slug}
            editToken={editToken}
            root={root}
            replies={repliesByRoot.get(root.id) ?? []}
            comments={comments}
            onCommentsChange={onCommentsChange}
          />
        ))
      )}
    </section>
  );
}
