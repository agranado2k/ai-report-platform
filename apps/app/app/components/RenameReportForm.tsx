import { useFetcher } from "@remix-run/react";
import { Button, Input } from "arp-ui";

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
