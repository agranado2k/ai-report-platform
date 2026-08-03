import { Form, Link } from "@remix-run/react";
import { Badge, Button, Checkbox, Input, MoreIcon } from "arp-ui";
import type { FolderNode } from "./FolderTree";

/**
 * The per-folder sharing menu in the dashboard sidebar (ADR-0076 §6 — the UI
 * that was deferred out of PR #230).
 *
 * IDIOM: the same native `<details>` kebab the report rows use — no JS, CSP
 * safe, and it degrades to a plain disclosure. It is deliberately NOT a new
 * interaction pattern.
 *
 * BUILD CONSTRAINT: this component (like every dashboard component) must not
 * import `arp-domain` — its barrel pulls `node:crypto` into the client bundle.
 * Every domain-derived decision below (may I manage this? which badge? what
 * warning?) already arrived as plain data on `FolderNode`, computed in the
 * loader by `folder-sharing.server.ts`, which mirrors `loadManagedFolder`.
 *
 * The Root never reaches here — the tree does not render a menu for it at all
 * (ADR-0076 §3: the domain rejects any visibility call on a folder with
 * `parentId === null`, so rendering-then-erroring would be a lie).
 */
export function FolderShareMenu({
  node,
  manageHref,
  inertShareNotice,
  rosterUnavailableNotice,
  open,
}: {
  node: FolderNode;
  /** Where "Manage sharing…" goes — the same page with `?manage=<id>`, which
   *  is what makes the loader pay for this folder's share roster. */
  manageHref: string;
  inertShareNotice: string;
  rosterUnavailableNotice: string;
  open: boolean;
}) {
  return (
    <details className="relative z-10 shrink-0" open={open}>
      {/* The accessible name is an `aria-label` rather than an `sr-only` span
          because React SSR splits `text {expression}` with a comment node —
          which would make the name unmatchable for anything reading the
          markup (the e2e suite included) while reading identically to AT. */}
      <summary
        aria-label={`Sharing options for ${node.name}`}
        className="flex size-6 cursor-pointer list-none items-center justify-center rounded-control text-subtle transition-colors hover:bg-surface-raised hover:text-fg [&::-webkit-details-marker]:hidden"
      >
        <MoreIcon className="h-3.5 w-3.5" />
      </summary>
      {/* Anchored LEFT, not right: the sidebar is only 14rem wide, so a
          right-anchored 18rem panel would hang off the page edge. Opening
          rightwards puts it over the (much wider) report list instead. */}
      <div className="absolute left-0 z-20 mt-1 w-72 rounded-card border border-border bg-surface p-2 text-left shadow-lg">
        <p className="px-1 pb-1 text-xs font-semibold text-fg">{`Sharing — ${node.name}`}</p>

        {node.manageable ? (
          <ManageControls
            node={node}
            manageHref={manageHref}
            inertShareNotice={inertShareNotice}
            rosterUnavailableNotice={rosterUnavailableNotice}
          />
        ) : (
          // Non-owner: the controls are shown DISABLED with the server's own
          // reason, rather than silently vanishing — a member who can see the
          // folder should learn why they can't change it (ADR-0076 §6).
          <div className="p-1">
            <p className="text-xs text-subtle">{node.blockedReason}</p>
            <Button type="button" size="sm" disabled className="mt-1.5 w-full justify-start">
              {node.visibility === "org" ? "Make private" : "Share with the whole org"}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

function ManageControls({
  node,
  manageHref,
  inertShareNotice,
  rosterUnavailableNotice,
}: {
  node: FolderNode;
  manageHref: string;
  inertShareNotice: string;
  rosterUnavailableNotice: string;
}) {
  const nextVisibility = node.visibility === "org" ? "private" : "org";
  return (
    <>
      {/* THE WARNING — BEFORE the action, never after, and there is exactly ONE
          of it (ADR-0076 §6 + §cascade). The server composes it: adopting this
          folder if it is legacy, adopting the legacy folders INSIDE it if the
          cascade runs (migration 0019 left every pre-ADR-0076 folder owner-less,
          so that is the common case, not an edge one), and — in the org
          direction — how many currently-private folders inside would be
          published. Adoption is permanent and has no transfer path. */}
      {node.shareWarning ? (
        <p
          role="note"
          className="mx-1 mb-1.5 rounded-control bg-warning/12 p-1.5 text-xs text-warning"
        >
          {node.shareWarning}
        </p>
      ) : null}

      {/* KEYED on the folder's sharing state: a successful toggle flips
          `visibility`, which changes the key, which REMOUNTS this form — so the
          cascade tick cannot survive into the opposite direction. It came back
          ticked, under a panel that now read "Share with the whole org" and its
          mass-exposure warning; one more click would have published the whole
          subtree (2026-08-03 dogfood, I-2). */}
      <Form method="post" key={node.formKey} className="flex flex-col gap-1.5 p-1">
        <input type="hidden" name="intent" value="set-folder-visibility" />
        <input type="hidden" name="folderId" value={node.id} />
        <input type="hidden" name="visibility" value={nextVisibility} />
        {/* THE NESTED-FOLDER GAP (ADR-0076 §cascade): the per-folder repair
            leaves pre-existing descendants as they were, and an org-visible
            descendant of a now-private parent grafts under Root in other
            members' sidebars — so its name still leaks. Opt-in, explicit, and
            applied in the ACTION as a loop over the same use case. The label is
            DIRECTION-AWARE and counted: the same checkbox mass-EXPOSES when the
            toggle runs the other way, and "apply to everything inside" said the
            same thing either way. Absent entirely when there is nothing inside,
            or more inside than one change may cover. */}
        {node.cascadeLabel ? (
          <label
            htmlFor={`cascade-${node.id}`}
            className="flex items-start gap-1.5 text-xs text-muted"
          >
            {/* `autoComplete="off"` is the other half of the same guarantee:
                the remount handles React's own re-render, this stops the
                BROWSER restoring the tick across a reload or a back-navigation,
                which no key can reach. */}
            <Checkbox
              id={`cascade-${node.id}`}
              name="cascade"
              value="on"
              autoComplete="off"
              className="mt-0.5"
            />
            <span>{node.cascadeLabel}</span>
          </label>
        ) : null}
        <Button type="submit" size="sm" className="w-full justify-center">
          {nextVisibility === "private" ? "Make private" : "Share with the whole org"}
        </Button>
      </Form>

      <div className="mt-1 border-t border-border pt-1">
        {node.sharesUnavailable ? (
          // The roster load FAILED. Saying nothing (or rendering an empty
          // roster) would turn an error into a positive claim about who can
          // see this folder — the exact thing this panel must never do.
          <p role="status" className="px-1 py-1 text-xs text-danger">
            {rosterUnavailableNotice}
          </p>
        ) : node.shares === null ? (
          <Link
            to={manageHref}
            className="block px-1 py-1 text-xs text-brand no-underline hover:text-brand-hover"
          >
            Manage who it's shared with →
          </Link>
        ) : (
          <ShareRoster node={node} shares={node.shares} inertShareNotice={inertShareNotice} />
        )}
      </div>
    </>
  );
}

function ShareRoster({
  node,
  shares,
  inertShareNotice,
}: {
  node: FolderNode;
  shares: readonly FolderShareRow[];
  inertShareNotice: string;
}) {
  return (
    <div className="p-1">
      <p className="mb-1 text-xs font-medium text-fg">Shared with</p>
      {shares.length === 0 ? (
        // "Only you can see this folder" is a claim about VISIBILITY, not about
        // the roster — so it may only be made for a `private` folder. An
        // org-visible folder with no individual shares was rendering a
        // categorical privacy assurance two lines under an "Org" badge, in
        // exactly the state ADR-0076 exists to repair.
        <p className="mb-1.5 text-xs text-subtle">
          {node.visibility === "private"
            ? "Not shared with anyone yet. Only you can see this folder."
            : "Not shared with anyone individually — but everyone in your org can already see this folder."}
        </p>
      ) : (
        <ul className="mb-1.5 flex flex-col gap-1">
          {shares.map((s) => (
            <li key={s.email} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-fg">{s.email}</span>
                <span className="block text-[0.65rem] text-subtle">Added {s.grantedAt}</span>
              </span>
              <Form method="post" className="shrink-0">
                <input type="hidden" name="intent" value="unshare-folder" />
                <input type="hidden" name="folderId" value={node.id} />
                <input type="hidden" name="email" value={s.email} />
                <Button type="submit" size="sm" variant="danger">
                  Remove
                </Button>
              </Form>
            </li>
          ))}
        </ul>
      )}
      {/* KEYED like the toggle above: a successful share moves the roster,
          which remounts this form with an EMPTY field. It used to keep the
          address that had just been granted — listed one line above it —
          so clicking Share again simply re-submitted it (2026-08-03
          dogfood, I-4). A refusal moves nothing, and keeps what was typed. */}
      <Form method="post" key={node.formKey} className="flex items-center gap-1.5">
        <input type="hidden" name="intent" value="share-folder" />
        <input type="hidden" name="folderId" value={node.id} />
        <Input
          type="email"
          name="email"
          required
          autoComplete="off"
          placeholder="teammate@example.com"
          aria-label={`Share ${node.name} with an email address`}
          size="sm"
          className="min-w-0 flex-1 text-xs"
        />
        <Button type="submit" size="sm">
          Share
        </Button>
      </Form>
      {/* Same promise the OpenAPI + MCP descriptions make: an out-of-org
          address is accepted and recorded, but is INERT — folder listings are
          org-scoped, so the grantee sees nothing until they join. */}
      <p className="mt-1 text-[0.65rem] leading-snug text-subtle">{inertShareNotice}</p>
    </div>
  );
}

/** One row of a folder's share roster, as the loader hands it over: the
 *  grantee's normalized email plus a pre-formatted granted-at date (formatted
 *  server-side so the markup is stable and locale drift can't hydrate-mismatch). */
export interface FolderShareRow {
  readonly email: string;
  readonly grantedAt: string;
}

/** The sidebar badge, as a standalone export so the tree renders it inline
 *  next to the folder name. The label is deliberately short — it shares a
 *  14rem column with a truncating folder name — so the full claim (including
 *  "this row's roster was never loaded") is carried in the `title`. */
export function FolderVisibilityBadge({ node }: { node: FolderNode }) {
  return (
    <Badge tone={node.badge.tone} title={node.badge.title} className="shrink-0 text-[0.65rem]">
      {node.badge.label}
    </Badge>
  );
}
