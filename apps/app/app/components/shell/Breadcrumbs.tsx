import { Link } from "@remix-run/react";
import { ChevronRightIcon, cx } from "arp-ui";
import type { Crumb } from "./shell-nav";

// The shell's breadcrumb bar (#333): where you are, with every ancestor a link.
// The trail is computed by the layout from the path + folder trail (pure
// helpers in shell-nav), so this component is a dumb renderer.
//
// It takes the header's free width and never more (#403): below `md` only the
// current crumb and its parent show — every ancestor stays reachable through
// the navigation's Folder tree — and a long name truncates, with its full text
// in `title`, rather than pushing the Upload action off-screen.
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const parentIndex = crumbs.length - 2;
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1 text-[13px] text-muted"
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span
            key={c.href ?? c.label}
            className={cx(
              "flex min-w-0 items-center gap-1",
              i < parentIndex && "max-md:hidden",
              last ? "shrink" : "shrink-[2]",
            )}
          >
            {i > 0 ? (
              <ChevronRightIcon
                className={cx(
                  "size-3.5 shrink-0 text-placeholder",
                  i === parentIndex && "max-md:hidden",
                )}
              />
            ) : null}
            {c.href && !last ? (
              <Link to={c.href} title={c.label} className="truncate no-underline hover:text-fg">
                {c.label}
              </Link>
            ) : (
              <span title={c.label} className={cx("truncate", last && "font-medium text-fg")}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
