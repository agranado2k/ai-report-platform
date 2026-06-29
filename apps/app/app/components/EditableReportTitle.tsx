import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";

type RenameResult = { ok: true } | { error: string };

/**
 * Click-to-rename report title. Click the title → it becomes an input; saving on
 * blur or Enter submits the existing `rename-report` action via useFetcher, which
 * revalidates the list in place (no navigation). Escape cancels. The report's
 * "open" affordance lives on the row's document icon, so the title click is
 * unambiguously "rename".
 *
 * Robustness:
 * - On a rejected rename (the action returns `{ error }`, e.g. ValidationError)
 *   the field stays open and shows the message (role="alert") — no silent revert.
 * - `cancelledRef` makes Escape discard reliably: unmounting the focused input
 *   fires a native `blur` (the save path), so the flag short-circuits `commit`.
 * - `submittedRef` prevents a double-submit if `blur` follows `requestSubmit`.
 */
export function EditableReportTitle({ slug, title }: { slug: string; title: string }) {
  const fetcher = useFetcher<RenameResult>();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const submittedRef = useRef(false);

  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const busy = fetcher.state !== "idle";

  // Focus + select the field when entering edit mode.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Settle the request: close on success; on failure stay open + allow a retry.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("ok" in fetcher.data) {
      setEditing(false);
    } else {
      submittedRef.current = false;
      inputRef.current?.focus();
    }
  }, [fetcher.state, fetcher.data]);

  const startEditing = () => {
    cancelledRef.current = false;
    submittedRef.current = false;
    setEditing(true);
  };

  const commit = (input: HTMLInputElement) => {
    if (cancelledRef.current || submittedRef.current) return; // Escape / already submitted.
    const next = input.value.trim();
    if (next && next !== title) {
      submittedRef.current = true;
      input.form?.requestSubmit();
    } else {
      setEditing(false); // empty or unchanged → just exit.
    }
  };

  if (editing) {
    return (
      <div>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="rename-report" />
          <input type="hidden" name="slug" value={slug} />
          <input
            ref={inputRef}
            name="title"
            defaultValue={title}
            aria-label={`Rename ${title}`}
            aria-invalid={error ? true : undefined}
            readOnly={busy}
            onBlur={(e) => commit(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelledRef.current = true;
                setEditing(false);
              }
            }}
            className={cx(
              "w-full rounded-control border bg-surface px-1.5 py-0.5 text-sm font-medium text-fg outline-none ring-2",
              error ? "border-danger ring-danger/25" : "border-brand ring-brand/25",
              busy && "opacity-70",
            )}
          />
        </fetcher.Form>
        {error ? (
          <p role="alert" className="mt-0.5 px-1.5 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Click to rename"
      className={cx(
        "block max-w-full truncate rounded-control border border-transparent px-1.5 py-0.5 text-left text-sm font-medium text-fg transition-colors",
        "hover:border-border hover:bg-surface-raised",
      )}
    >
      {title}
    </button>
  );
}
