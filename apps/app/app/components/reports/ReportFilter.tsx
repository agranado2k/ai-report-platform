import { useLocation, useNavigate } from "@remix-run/react";
import { cx, Input, Kbd, SearchIcon } from "arp-ui";
import { useEffect, useRef } from "react";
import { isEditableTarget } from "../shell/shell-nav";
import { filterNavTarget, isFilterFocusKey } from "./report-filter";

const FILTER_ID = "report-filter";

// Filter-as-you-type (#334): a debounced navigation that rewrites `?q=` (the
// server-side searchReports match) — no submit button. "/" focuses it from
// anywhere. The URL math + the focus-key are pure (report-filter.ts); this is
// the thin client wrapper. Uncontrolled input: navigating with `replace` must
// not reset what the user is still typing.
export function ReportFilter({ defaultQuery }: { defaultQuery: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFilterFocusKey(e, isEditableTarget(e.target as HTMLElement | null))) {
        e.preventDefault();
        document.getElementById(FILTER_ID)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="relative max-w-sm flex-1">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-placeholder" />
      <Input
        id={FILTER_ID}
        type="search"
        defaultValue={defaultQuery}
        aria-label="Filter reports by title or slug"
        placeholder="Filter by title or slug"
        className={cx("pr-9 pl-9")}
        onChange={(e) => {
          const value = e.currentTarget.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            navigate(filterNavTarget(location.search, value), {
              replace: true,
              preventScrollReset: true,
            });
          }, 250);
        }}
      />
      <Kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">/</Kbd>
    </div>
  );
}
