import { useFetcher } from "@remix-run/react";
import { Button, Input } from "arp-ui";
import { useEffect, useRef } from "react";
import { makeToast, TOAST_EVENT } from "./feedback/toast";

type RenameResult = { ok: true } | { error: string };

/**
 * Inline rename field for the report-row kebab menu. Lives inside the
 * `<details>` panel alongside Move/Delete (report-row-cleanup: the row itself
 * is a stretched link to `/open`, so the title is no longer a click target —
 * renaming moved off the title into here, next to the other row actions).
 * Submits the existing `rename-report` action via `useFetcher`, which
 * revalidates the dashboard loader in place (no navigation).
 *
 * `key={title}` on the input remounts it whenever the report's title changes
 * (i.e. after a successful rename) — the field is an uncontrolled input
 * (`defaultValue`), so without the remount it would keep showing the value
 * it had when the kebab was first opened instead of picking up the fresh
 * title from a revalidated loader.
 */
export function RenameReportForm({ slug, title }: { slug: string; title: string }) {
  const fetcher = useFetcher<RenameResult>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const busy = fetcher.state !== "idle";

  // Close the loop with a toast on a successful rename (report §08). The inline
  // field stays for the edit itself (a single-field edit needs no dialog); the
  // toast is the confirmation the rest of the mutations get from their redirect
  // flash. Guarded against re-firing on revalidation with a one-shot ref.
  const toasted = useRef(false);
  useEffect(() => {
    if (fetcher.state !== "idle") {
      toasted.current = false;
      return;
    }
    if (fetcher.data && "ok" in fetcher.data && !toasted.current) {
      toasted.current = true;
      window.dispatchEvent(
        new CustomEvent(TOAST_EVENT, { detail: makeToast({ title: "Report renamed" }) }),
      );
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="p-1">
      <fetcher.Form method="post" className="flex items-center gap-1.5">
        <input type="hidden" name="intent" value="rename-report" />
        <input type="hidden" name="slug" value={slug} />
        <Input
          key={title}
          name="title"
          defaultValue={title}
          aria-label={`Rename ${title}`}
          aria-invalid={error ? true : undefined}
          readOnly={busy}
          size="sm"
          className="min-w-0 flex-1 text-xs"
        />
        <Button type="submit" size="sm">
          Rename
        </Button>
      </fetcher.Form>
      {error ? (
        <p role="alert" className="mt-0.5 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
