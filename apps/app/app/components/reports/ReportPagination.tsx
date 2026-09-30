import { Link } from "@remix-run/react";

export function ReportPagination({
  previousHref,
  nextHref,
}: {
  previousHref: string | null;
  nextHref: string | null;
}) {
  if (!previousHref && !nextHref) return null;
  return (
    <nav aria-label="Report pages" className="mt-4 flex items-center gap-3 text-sm">
      {previousHref ? (
        <Link
          to={previousHref}
          className="inline-flex min-h-11 min-w-11 items-center text-brand hover:text-brand-hover"
        >
          ← Prev
        </Link>
      ) : (
        <span className="text-subtle">← Prev</span>
      )}
      {nextHref ? (
        <Link
          to={nextHref}
          className="inline-flex min-h-11 min-w-11 items-center text-brand hover:text-brand-hover"
        >
          Next →
        </Link>
      ) : (
        <span className="text-subtle">Next →</span>
      )}
    </nav>
  );
}
