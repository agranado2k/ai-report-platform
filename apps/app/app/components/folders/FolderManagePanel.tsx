import { useFetcher } from "@remix-run/react";
// TYPE-ONLY imports (erased under verbatimModuleSyntax): the barrels never reach
// the client bundle, so the panel stays free of `arp-domain`'s `node:crypto` and
// of the server module's `ops()` — it renders conclusions the server computed.
import type { FolderVisibility } from "arp-domain";
import type {
  FolderManageContext,
  FolderOutcomeTone,
  FolderShareRow,
} from "../../server/folder-sharing.server";
import { Badge, type BadgeTone, Button, Checkbox, cx, Input } from "arp-ui";
import { useEffect, useRef } from "react";
import { makeToast, TOAST_EVENT } from "../feedback/toast";

/**
 * The content-header MANAGEMENT panel for the `?folder=`-selected folder
 * (ADR-0087). Replaces the in-body `FolderTree` management column: the `_app`
 * shell rail is now the sole folder-navigation surface, and per-folder
 * management reads best as a header over the folder's own report list.
 *
 * SURFACE. Name + visibility badge come from tree data (cheap, already on the
 * dashboard node). "Manage ▾" is a CLIENT-SIDE disclosure (a native
 * `<details>`), not a navigation — opening it fires ONE `useFetcher.load()`
 * against `GET /shares?include=manage`, so the expensive, sensitive roster query
 * is paid for only when management is opened. `data === undefined` is "never
 * asked", kept distinct from an empty roster.
 *
 * WRITES (this slice). Each write posts through the dashboard's own
 * cookie-authenticated action via `fetcher.Form` — in place, no full-page
 * round-trip — reusing the tested ADR-0076/0078 use-case path (the cascade loop,
 * the structured partial outcome, the owner-or-legacy gate). On success the
 * panel re-fires the roster fetcher and raises the mutation toast; the write
 * forms are KEYED on the loaded form key so a successful share/toggle remounts
 * them, and a stale cascade tick or submitted address cannot survive into the
 * next state (ADR-0076 §6). The migration of these writes onto the public REST
 * endpoints (retiring the dashboard intents) is the deferred remainder.
 *
 * BUILD CONSTRAINT. Like every dashboard component this must not import
 * `arp-domain` at runtime; every domain-derived decision (manageable? which
 * badge? which tone? what warning?) arrives as plain data.
 */

/** The selected folder as the panel needs it — the cheap, tree-derived facts
 *  the dashboard loader already computes for every folder. */
export interface FolderManageNode {
  readonly id: string;
  readonly name: string;
  readonly visibility: FolderVisibility;
  readonly isRoot: boolean;
  readonly manageable: boolean;
  readonly blockedReason: string | null;
  /** The count-less badge (roster not loaded) — replaced by the loaded badge
   *  once "Manage ▾" fetches the roster. */
  readonly badge: { readonly label: string; readonly tone: BadgeTone; readonly title: string };
}

/** The dashboard action's folder-scoped outcome, in the panel's read of it. */
interface FolderActionData {
  readonly folderId: string;
  readonly error: string | null;
  readonly summary: string | null;
  readonly partial: boolean;
  readonly tone: FolderOutcomeTone;
}

const TONE_CLASS: Record<FolderOutcomeTone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/10 text-danger",
};

type ManageFetcher = ReturnType<typeof useFetcher<FolderManageContext>>;
type WriteFetcher = ReturnType<typeof useFetcher<FolderActionData>>;

export function FolderManagePanel({
  node,
  inertShareNotice,
  rosterUnavailableNotice,
  personShareLimitNotice,
}: {
  node: FolderManageNode;
  inertShareNotice: string;
  rosterUnavailableNotice: string;
  personShareLimitNotice: string;
}) {
  const manage = useFetcher<FolderManageContext>();
  const write = useFetcher<FolderActionData>();
  const manageUrl = `/api/v1/folders/${node.id}/shares?include=manage`;

  // Re-fire the roster read after every SUCCESSFUL write (ADR-0087) and raise
  // the mutation toast (#336). A refusal moves nothing — no reload, no toast,
  // and the fields keep what the operator typed to retry.
  const handled = useRef<FolderActionData | null>(null);
  useEffect(() => {
    if (write.state !== "idle" || !write.data) return;
    if (write.data === handled.current) return;
    handled.current = write.data;
    if (write.data.error) return;
    manage.load(manageUrl);
    window.dispatchEvent(
      new CustomEvent(TOAST_EVENT, {
        detail: makeToast({ title: write.data.summary ?? "Folder updated" }),
      }),
    );
  }, [write.state, write.data, manage, manageUrl]);

  // The loaded roster upgrades the badge ("Private" → "Shared with 2") and
  // supplies the form-remount key; before the first load the tree's count-less
  // badge stands and the forms key off the folder id.
  const ctx = manage.data ?? null;
  const badge = ctx?.badge ?? node.badge;
  const formKey = ctx?.formKey ?? node.id;
  const outcome = write.data ?? null;

  // The Root has no management chrome and its literal name is hidden (ADR-0087
  // §Root): the domain refuses every visibility/share/rename/delete on it, so
  // the panel renders nothing and the report list stands alone. Checked AFTER
  // the hooks so their call order is unconditional (Rules of Hooks).
  if (node.isRoot) return null;

  return (
    <section className="mb-6 rounded-card border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 truncate text-base font-semibold text-fg" title={node.name}>
          {node.name}
        </h2>
        <Badge tone={badge.tone} title={badge.title} className="shrink-0">
          {badge.label}
        </Badge>
        <div className="ml-auto">
          {node.manageable ? (
            <ManageDisclosure
              node={node}
              manage={manage}
              manageUrl={manageUrl}
              write={write}
              formKey={formKey}
              inertShareNotice={inertShareNotice}
              rosterUnavailableNotice={rosterUnavailableNotice}
              personShareLimitNotice={personShareLimitNotice}
            />
          ) : (
            // Non-owner: no "Manage", but the server's own reason is shown rather
            // than the affordance silently vanishing (ADR-0076 §6).
            <span className="text-xs text-subtle">{node.blockedReason}</span>
          )}
        </div>
      </div>

      {outcome ? (
        <p
          role="status"
          className={cx("mt-2 rounded-control px-2 py-1.5 text-xs", TONE_CLASS[outcome.tone])}
        >
          {outcome.error ?? outcome.summary}
        </p>
      ) : null}
    </section>
  );
}

function ManageDisclosure({
  node,
  manage,
  manageUrl,
  write,
  formKey,
  inertShareNotice,
  rosterUnavailableNotice,
  personShareLimitNotice,
}: {
  node: FolderManageNode;
  manage: ManageFetcher;
  manageUrl: string;
  write: WriteFetcher;
  formKey: string;
  inertShareNotice: string;
  rosterUnavailableNotice: string;
  personShareLimitNotice: string;
}) {
  const nextVisibility = node.visibility === "org" ? "private" : "org";
  const ctx = manage.data ?? null;
  // The roster read failed (transient DB error, or an actor the use case
  // refuses): a rendered empty roster would be a positive claim about who can
  // see the folder, made from no data at all.
  const rosterUnavailable = manage.state === "idle" && !manage.data && Boolean(manageError(manage));

  return (
    <details
      className="relative"
      onToggle={(e) => {
        // Pay for the roster only when management is actually opened, and only
        // once — `data === undefined` is the "never asked" state.
        if ((e.currentTarget as HTMLDetailsElement).open && !manage.data && manage.state === "idle")
          manage.load(manageUrl);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-control border border-border px-2 py-1 text-xs font-medium text-fg transition-colors hover:bg-surface-raised [&::-webkit-details-marker]:hidden">
        Manage
        <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-80 rounded-card border border-border bg-surface p-3 text-left shadow-lg">
        {manage.state === "loading" && !manage.data ? (
          <p className="px-1 py-2 text-xs text-subtle">Loading sharing…</p>
        ) : rosterUnavailable ? (
          <p role="status" className="px-1 py-1 text-xs text-danger">
            {rosterUnavailableNotice}
          </p>
        ) : ctx ? (
          <ManageBody
            node={node}
            ctx={ctx}
            write={write}
            formKey={formKey}
            nextVisibility={nextVisibility}
            inertShareNotice={inertShareNotice}
            personShareLimitNotice={personShareLimitNotice}
          />
        ) : (
          <p className="px-1 py-2 text-xs text-subtle">Open to load this folder’s sharing.</p>
        )}
      </div>
    </details>
  );
}

/** The fetcher's data can be an error problem body rather than a manage context
 *  when the load is refused — treat a payload without `object` as unavailable. */
function manageError(manage: ManageFetcher): boolean {
  const d = manage.data as unknown;
  return d != null && (typeof d !== "object" || !("object" in (d as object)));
}

function ManageBody({
  node,
  ctx,
  write,
  formKey,
  nextVisibility,
  inertShareNotice,
  personShareLimitNotice,
}: {
  node: FolderManageNode;
  ctx: FolderManageContext;
  write: WriteFetcher;
  formKey: string;
  nextVisibility: FolderVisibility;
  inertShareNotice: string;
  personShareLimitNotice: string;
}) {
  return (
    <>
      {/* THE WARNING — before the action, never after, and there is exactly ONE
          of it (ADR-0076 §6 + §cascade): adoption of this folder if legacy, of
          the legacy folders inside it if the cascade runs, and — in the org
          direction — how many currently-private folders would be published. */}
      {ctx.shareWarning ? (
        <p role="note" className="mb-2 rounded-control bg-warning/12 p-1.5 text-xs text-warning">
          {ctx.shareWarning}
        </p>
      ) : null}

      {/* Visibility toggle + the direction-aware, counted cascade. KEYED on the
          loaded form key so a successful toggle (which flips visibility, then
          re-fires the roster load) remounts it — the cascade tick cannot survive
          into the opposite direction (ADR-0076 §6, 2026-08-03 dogfood I-2). */}
      <write.Form method="post" key={`vis-${formKey}`} className="flex flex-col gap-1.5">
        <input type="hidden" name="intent" value="set-folder-visibility" />
        <input type="hidden" name="folderId" value={node.id} />
        <input type="hidden" name="visibility" value={nextVisibility} />
        {ctx.cascadeLabel ? (
          <label
            htmlFor={`cascade-${node.id}`}
            className="flex items-start gap-1.5 text-xs text-muted"
          >
            <Checkbox
              id={`cascade-${node.id}`}
              name="cascade"
              value="on"
              autoComplete="off"
              className="mt-0.5"
            />
            <span>{ctx.cascadeLabel}</span>
          </label>
        ) : null}
        <Button type="submit" size="sm" className="w-full justify-center">
          {nextVisibility === "private" ? "Make private" : "Share with the whole org"}
        </Button>
      </write.Form>

      <ReportBulkApply node={node} ctx={ctx} write={write} />

      <div className="mt-2 border-t border-border pt-2">
        <ShareRoster
          node={node}
          shares={ctx.shares}
          write={write}
          formKey={formKey}
          inertShareNotice={inertShareNotice}
          personShareLimitNotice={personShareLimitNotice}
        />
      </div>

      {/* Rename + delete (ADR-0076): rename is in place; deleting the SELECTED
          folder navigates to All-reports with a toast (the action redirects). */}
      <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
        <write.Form method="post" key={`rename-${node.name}`} className="flex gap-1.5">
          <input type="hidden" name="intent" value="rename-folder" />
          <input type="hidden" name="folderId" value={node.id} />
          <Input
            name="name"
            defaultValue={node.name}
            aria-label={`Rename ${node.name}`}
            size="sm"
            className="min-w-0 flex-1 text-xs"
          />
          <Button type="submit" size="sm">
            Rename
          </Button>
        </write.Form>
        <write.Form method="post">
          <input type="hidden" name="intent" value="delete-folder" />
          <input type="hidden" name="folderId" value={node.id} />
          <Button type="submit" size="sm" variant="danger" className="w-full justify-center">
            Delete (must be empty)
          </Button>
        </write.Form>
      </div>
    </>
  );
}

/** The ADR-0078 bulk apply — "also share the N reports inside this folder".
 *  Three separate submits, not a select + submit: each button says what it does
 *  and none can be left staged in a form that outlives its state. */
function ReportBulkApply({
  node,
  ctx,
  write,
}: {
  node: FolderManageNode;
  ctx: FolderManageContext;
  write: WriteFetcher;
}) {
  if (!ctx.reportSharing) return null;
  const { visibleCount, overCap } = ctx.reportSharing;
  if (visibleCount === 0) {
    return (
      <p className="mt-2 border-t border-border pt-2 text-xs leading-snug text-subtle">
        There are no reports you can see in this folder.
      </p>
    );
  }
  const subject = `${visibleCount} ${visibleCount === 1 ? "report" : "reports"}`;
  if (overCap) {
    return (
      <p className="mt-2 border-t border-border pt-2 text-xs leading-snug text-warning">
        This folder holds more reports than one change can cover, so sharing them all at once isn’t
        available here. Share them from their own rows instead.
      </p>
    );
  }
  return (
    <div className="mt-2 border-t border-border pt-2">
      <p className="mb-1 text-xs font-medium text-fg">The reports inside</p>
      <p className="mb-1.5 text-xs leading-snug text-subtle">
        Sharing this folder shows its NAME. These change the {subject} inside it that you can see.
        Only reports you own change, and only those not already in the state you pick — reports with
        a password, an invite list, or a public link are never touched. Everything left alone is
        listed back to you with the reason.
      </p>
      <div className="flex flex-col gap-1">
        {[
          { sharing: "org_view", label: `Let your org VIEW the ${subject}` },
          { sharing: "org_edit", label: `Let your org view AND EDIT the ${subject}` },
          { sharing: "private", label: `Make the ${subject} private again` },
        ].map((choice) => (
          <write.Form method="post" key={choice.sharing} autoComplete="off">
            <input type="hidden" name="intent" value="apply-folder-sharing" />
            <input type="hidden" name="folderId" value={node.id} />
            <input type="hidden" name="sharing" value={choice.sharing} />
            <Button
              type="submit"
              size="sm"
              variant={choice.sharing === "private" ? "secondary" : "primary"}
              className="w-full justify-start text-left text-xs"
            >
              {choice.label}
            </Button>
          </write.Form>
        ))}
      </div>
    </div>
  );
}

function ShareRoster({
  node,
  shares,
  write,
  formKey,
  inertShareNotice,
  personShareLimitNotice,
}: {
  node: FolderManageNode;
  shares: readonly FolderShareRow[];
  write: WriteFetcher;
  formKey: string;
  inertShareNotice: string;
  personShareLimitNotice: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-fg">Shared with</p>
      {shares.length === 0 ? (
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
                <span className="block text-xs text-subtle">Added {s.grantedAt}</span>
              </span>
              <write.Form method="post" className="shrink-0">
                <input type="hidden" name="intent" value="unshare-folder" />
                <input type="hidden" name="folderId" value={node.id} />
                <input type="hidden" name="email" value={s.email} />
                <Button type="submit" size="sm" variant="danger">
                  Remove
                </Button>
              </write.Form>
            </li>
          ))}
        </ul>
      )}
      {/* KEYED like the toggle: a successful share re-fires the roster load,
          which changes the count and the key, remounting this form with an
          EMPTY field so the just-granted address is never one click from being
          re-submitted (2026-08-03 dogfood I-4). */}
      <write.Form method="post" key={`share-${formKey}`} className="flex items-center gap-1.5">
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
      </write.Form>
      <p className="mt-1 text-xs leading-snug text-subtle">{inertShareNotice}</p>
      <p className="mt-1 text-xs leading-snug text-subtle">{personShareLimitNotice}</p>
    </div>
  );
}
