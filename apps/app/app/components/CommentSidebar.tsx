// The editor's comment sidebar (ADR-0064, editor comment UI slice). Lists the
// report's Threads (root comments + their single-level replies, ADR-0064
// §2/§4) loaded server-side by reports.$slug.edit.tsx's own loader — this
// component never fetches comments itself. Mutations (add/reply/resolve) go
// through fetchers posting to the reports.$slug.comments resource route;
// Remix's default revalidation refreshes the edit route's loader afterward,
// so the list here reflects reality without any manual refetch wiring.
//
// JUDGMENT CALL: no delete/moderation UI here — the task brief's scope is
// "add (on selection), reply (single level), resolve" only. `deleteComment`
// stays unconsumed by this slice (see reports.$slug.comments.ts's own note).
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { buildSelectionAnchor } from "../editor/anchor";
import type { CommentDto } from "../server/comment-dto.server";
import type { CommentActionResult } from "./comment-composer-lifecycle";
import { isCommentSubmitSuccess } from "./comment-composer-lifecycle";
import { Badge, Button, Card, Textarea } from "./index";
import type { EditorSelection } from "./ReportEditor";

export interface CommentSidebarProps {
  readonly slug: string;
  /** The version id (wire-encoded, ADR-0052) currently open in the editor —
   *  every NEW comment/reply anchors to it (ADR-0064 §2a's version-pinned
   *  fallback, always populated). */
  readonly versionId: string;
  readonly comments: readonly CommentDto[];
  /** The editor's current non-empty selection, or `null` when nothing is
   *  selected — gates whether the "new comment" composer renders at all. */
  readonly pendingSelection: EditorSelection | null;
  /** Called on Cancel, or once the composer's add-comment POST resolves
   *  SUCCESSFULLY — never on failure. A 422/403 (e.g. a write grant revoked
   *  mid-session, ADR-0060) must leave the composer mounted with its typed
   *  body and `<ActionError>` visible, so this only fires once
   *  `isCommentSubmitSuccess` is true (PR #157 review, Fix 2). */
  readonly onSubmittedSelection: () => void;
}

function actionUrl(slug: string): string {
  return `/reports/${slug}/comments`;
}

function authorLabel(c: CommentDto): string {
  return c.authorEmail ?? c.authorId;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function ActionError({ data }: { readonly data: CommentActionResult | undefined }) {
  if (!data || !("error" in data)) return null;
  return (
    <p className="mt-1 text-xs text-danger" role="alert">
      ✗ {data.error}
    </p>
  );
}

/** The "select text, click Comment" composer — only rendered while there's a
 *  non-empty selection (you comment ON a quote, not on nothing).
 *
 *  PR #157 review, Fix 2: `onSubmitted` (which clears the parent's
 *  `pendingSelection` and, in turn, unmounts this component) must NOT fire
 *  the moment the POST goes out — only once it resolves successfully. Firing
 *  early meant a 422/403 unmounted the composer before its `<ActionError>`
 *  could ever render, silently dropping the error and the typed body. So
 *  `submit` only calls `fetcher.submit`; the success effect below — driven by
 *  the pure `isCommentSubmitSuccess` gate — is what clears the body and
 *  calls `onSubmitted`. On failure, `fetcher.data` carries `{ error }`,
 *  `busy` drops back to false, and the composer stays mounted with the typed
 *  body intact so the user can retry. */
function NewCommentComposer({
  slug,
  versionId,
  selection,
  onSubmitted,
}: {
  readonly slug: string;
  readonly versionId: string;
  readonly selection: EditorSelection;
  readonly onSubmitted: () => void;
}) {
  const fetcher = useFetcher<CommentActionResult>();
  const [body, setBody] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (isCommentSubmitSuccess(fetcher.state, fetcher.data)) {
      setBody("");
      onSubmitted();
    }
  }, [fetcher.state, fetcher.data, onSubmitted]);

  const submit = () => {
    if (!body.trim()) return;
    const anchor = buildSelectionAnchor({
      versionId,
      from: selection.from,
      to: selection.to,
      text: selection.text,
    });
    fetcher.submit(
      JSON.stringify({
        intent: "add",
        body,
        anchor: {
          versionId: anchor.versionId,
          textQuote: anchor.textQuote,
          relative: anchor.relative,
        },
      }),
      { method: "post", action: actionUrl(slug), encType: "application/json" },
    );
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
      <ActionError data={fetcher.data} />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onSubmitted} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? "Posting…" : "Comment"}
        </Button>
      </div>
    </Card>
  );
}

/** One Thread: a root comment plus its (single-level) replies. */
function CommentThread({
  slug,
  root,
  replies,
}: {
  readonly slug: string;
  readonly root: CommentDto;
  readonly replies: readonly CommentDto[];
}) {
  const replyFetcher = useFetcher<CommentActionResult>();
  const resolveFetcher = useFetcher<CommentActionResult>();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");

  const replyBusy = replyFetcher.state !== "idle";
  const resolveBusy = resolveFetcher.state !== "idle";

  const submitReply = () => {
    if (!replyBody.trim()) return;
    // A reply anchors to the SAME location as its root — no fresh selection
    // needed to reply (only the root comment is created off a selection).
    replyFetcher.submit(
      JSON.stringify({
        intent: "reply",
        parentCommentId: root.id,
        body: replyBody,
        anchor: {
          versionId: root.anchor.versionId,
          textQuote: root.anchor.textQuote,
          ...(root.anchor.relative !== undefined ? { relative: root.anchor.relative } : {}),
        },
      }),
      { method: "post", action: actionUrl(slug), encType: "application/json" },
    );
    setReplyBody("");
    setReplyOpen(false);
  };

  const resolve = () => {
    resolveFetcher.submit(JSON.stringify({ intent: "resolve", commentId: root.id }), {
      method: "post",
      action: actionUrl(slug),
      encType: "application/json",
    });
  };

  return (
    <Card className="mb-3 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg">{authorLabel(root)}</span>
        {root.resolvedAt ? (
          <Badge tone="success">Resolved</Badge>
        ) : (
          <Badge tone="neutral">Open</Badge>
        )}
      </div>
      <p className="mb-1 text-xs italic text-subtle">"{root.anchor.textQuote.slice(0, 80)}"</p>
      <p className="text-sm text-fg">{root.body}</p>
      <p className="mt-1 text-[10px] text-subtle">{formatTimestamp(root.createdAt)}</p>

      {replies.map((reply) => (
        <div key={reply.id} className="mt-2 border-l border-border pl-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-fg">{authorLabel(reply)}</span>
            <span className="text-[10px] text-subtle">{formatTimestamp(reply.createdAt)}</span>
          </div>
          <p className="text-sm text-fg">{reply.body}</p>
        </div>
      ))}

      <ActionError data={resolveFetcher.data} />
      <ActionError data={replyFetcher.data} />

      {replyOpen ? (
        <div className="mt-2">
          <Textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Reply…"
            rows={2}
            className="w-full"
          />
          <div className="mt-2 flex justify-end gap-2">
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
      ) : (
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setReplyOpen(true)}>
            Reply
          </Button>
          {root.resolvedAt ? null : (
            <Button variant="ghost" size="sm" onClick={resolve} disabled={resolveBusy}>
              {resolveBusy ? "Resolving…" : "Resolve"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function CommentSidebar({
  slug,
  versionId,
  comments,
  pendingSelection,
  onSubmittedSelection,
}: CommentSidebarProps) {
  const roots = comments.filter((c) => c.parentId === null);
  const repliesByRoot = new Map<string, CommentDto[]>();
  for (const c of comments) {
    if (c.parentId === null) continue;
    const list = repliesByRoot.get(c.parentId) ?? [];
    list.push(c);
    repliesByRoot.set(c.parentId, list);
  }
  const sortedRoots = [...roots].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <aside className="flex w-full flex-col gap-2" aria-label="Comments">
      <h2 className="mb-1 text-sm font-semibold text-fg">
        Comments{comments.length ? ` (${comments.length})` : ""}
      </h2>

      {pendingSelection ? (
        <NewCommentComposer
          slug={slug}
          versionId={versionId}
          selection={pendingSelection}
          onSubmitted={onSubmittedSelection}
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
            slug={slug}
            root={root}
            replies={repliesByRoot.get(root.id) ?? []}
          />
        ))
      )}
    </aside>
  );
}
