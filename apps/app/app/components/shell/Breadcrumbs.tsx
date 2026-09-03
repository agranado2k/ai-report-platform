import { Link } from "@remix-run/react";
import { ChevronRightIcon } from "arp-ui";
import type { Crumb } from "./shell-nav";

// The shell's breadcrumb bar (#333): where you are, with every ancestor a link.
// The trail is computed by the layout from the path + folder trail (pure
// helpers in shell-nav), so this component is a dumb renderer.
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px] text-muted">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.href ?? c.label} className="flex items-center gap-1">
            {i > 0 ? <ChevronRightIcon className="size-3.5 text-placeholder" /> : null}
            {c.href && !last ? (
              <Link to={c.href} className="no-underline hover:text-fg">
                {c.label}
              </Link>
            ) : (
              <span className={last ? "font-medium text-fg" : undefined}>{c.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
