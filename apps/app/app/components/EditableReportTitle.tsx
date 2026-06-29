import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";

/**
 * Click-to-rename report title. Click the title → it becomes an input; saving on
 * blur or Enter submits the existing `rename-report` action via useFetcher, which
 * revalidates the list in place (no navigation). Escape cancels. The report's
 * "open" affordance lives on the row's document icon, so the title click is
 * unambiguously "rename".
 *
 * Submits only when the value actually changed (and is non-empty) — a no-op blur
 * just exits edit mode. Optimistic: the in-flight title shows immediately.
 */
export function EditableReportTitle({ slug, title }: { slug: string; title: string }) {
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the field when entering edit mode.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const submitting = fetcher.formData?.get("intent") === "rename-report";
  const shown = submitting ? String(fetcher.formData?.get("title") ?? title) : title;

  const commit = (input: HTMLInputElement) => {
    const next = input.value.trim();
    if (next && next !== title) input.form?.requestSubmit();
    else setEditing(false);
  };

  if (editing) {
    return (
      <fetcher.Form method="post" onSubmit={() => setEditing(false)} className="block">
        <input type="hidden" name="intent" value="rename-report" />
        <input type="hidden" name="slug" value={slug} />
        <input
          ref={inputRef}
          name="title"
          defaultValue={title}
          aria-label={`Rename ${title}`}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="w-full rounded-control border border-brand bg-surface px-1.5 py-0.5 text-sm font-medium text-fg outline-none ring-2 ring-brand/25"
        />
      </fetcher.Form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to rename"
      className={cx(
        "block max-w-full truncate rounded-control border border-transparent px-1.5 py-0.5 text-left text-sm font-medium text-fg transition-colors",
        "hover:border-border hover:bg-surface-raised",
        submitting && "opacity-60",
      )}
    >
      {shown}
    </button>
  );
}
