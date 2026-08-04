import { Form } from "@remix-run/react";
import { Badge, Button, MoreIcon } from "arp-ui";

/**
 * The per-report sharing control in the dashboard list (ADR-0078 §12) — the
 * report-row counterpart to `FolderShareMenu`.
 *
 * IDIOM: the same native `<details>` kebab the report rows and the folder
 * sidebar already use — no JS, CSP-safe, degrades to a plain disclosure. It is
 * deliberately NOT a new interaction pattern.
 *
 * BUILD CONSTRAINT: this component (like every dashboard component) must not
 * import `arp-domain` — its barrel pulls `node:crypto` into the client bundle.
 * Every domain-derived decision below (may I change this? which badge? what
 * would this discard?) already arrived as plain data on `ReportSharingNode`,
 * computed in the loader by `report-sharing.server.ts`.
 *
 * ZERO-JS CONFIRMATION: leaving an advanced mode takes a SECOND SUBMIT, not a
 * `window.confirm` (which the CSP posture and the zero-JS idiom both rule out,
 * and which no server ever sees). The first submit comes back as a rendered
 * warning with a confirm button; only that second button carries
 * `confirm_discard`.
 */
export interface ReportSharingChoice {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
}

export interface ReportSharingNode {
  readonly slug: string;
  readonly title: string;
  readonly badge: { readonly label: string; readonly tone: string; readonly title: string };
  /** Would the server accept a sharing change from this actor? */
  readonly manageable: boolean;
  /** The server's own reason, when it wouldn't. */
  readonly blockedReason: string | null;
  /** The state it is in now, or null for an advanced mode. */
  readonly state: string | null;
  /** What a change would discard — its presence is what makes this control ask. */
  readonly discardWarning: string | null;
  /** Remounts the form after a successful action (the #237 hazard). */
  readonly formKey: string;
}

export function ReportSharingMenu({
  node,
  choices,
  /** The state the operator picked on a first submit that needed confirming,
   *  echoed back by the server. Null = nothing is pending confirmation. */
  pendingState,
}: {
  node: ReportSharingNode;
  choices: readonly ReportSharingChoice[];
  pendingState: string | null;
}) {
  return (
    <details className="relative z-10 shrink-0">
      {/* An `aria-label` rather than an `sr-only` span: React SSR splits
          `text {expression}` with a comment node, which would make the name
          unmatchable for anything reading the markup (the e2e suite included)
          while reading identically to AT. */}
      <summary
        aria-label={`Sharing options for ${node.title}`}
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-control text-subtle transition-colors hover:bg-surface-raised hover:text-fg [&::-webkit-details-marker]:hidden"
      >
        <Badge
          tone={node.badge.tone as never}
          title={node.badge.title}
          className="shrink-0 text-[0.65rem]"
        >
          {node.badge.label}
        </Badge>
        <MoreIcon className="ml-1 h-3.5 w-3.5" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-card border border-border bg-surface p-2 text-left shadow-lg">
        <p className="px-1 pb-1 text-xs font-semibold text-fg">{`Sharing — ${node.title}`}</p>

        {node.manageable ? (
          <SharingControls node={node} choices={choices} pendingState={pendingState} />
        ) : (
          // Non-owner: the control is shown DISABLED with the server's own
          // reason rather than silently vanishing — a member who can see the
          // report should learn why they can't change it (the ADR-0076 §6 rule,
          // applied to reports).
          <div className="p-1">
            <p className="text-xs text-subtle">{node.blockedReason}</p>
            <Button type="button" size="sm" disabled className="mt-1.5 w-full justify-start">
              Change sharing
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

function SharingControls({
  node,
  choices,
  pendingState,
}: {
  node: ReportSharingNode;
  choices: readonly ReportSharingChoice[];
  pendingState: string | null;
}) {
  // The confirmation step. It is shown ONLY for the report the operator just
  // acted on, and only while the server is still refusing — so it can never be
  // a stale button sitting under a panel that has already moved on.
  if (pendingState && node.discardWarning) {
    return (
      <div className="p-1">
        <p role="note" className="mb-1.5 rounded-control bg-warning/12 p-1.5 text-xs text-warning">
          {node.discardWarning}
        </p>
        <Form method="post" className="flex flex-col gap-1.5">
          <input type="hidden" name="intent" value="set-report-sharing" />
          <input type="hidden" name="slug" value={node.slug} />
          <input type="hidden" name="sharing" value={pendingState} />
          {/* The ONLY place this flag is ever sent. A first submit never
              carries it, so nothing configured can be discarded without the
              operator having read the sentence above. */}
          <input type="hidden" name="confirm_discard" value="true" />
          <Button type="submit" size="sm" variant="danger" className="w-full justify-center">
            Yes, change it anyway
          </Button>
        </Form>
        <p className="mt-1 text-[0.65rem] leading-snug text-subtle">
          Close this menu to keep the current setting.
        </p>
      </div>
    );
  }

  return (
    // KEYED on the report's sharing state: a successful change moves the key,
    // which REMOUNTS this form — so a choice staged for the old state cannot
    // survive into the new one (the #237 hazard). A refusal moves nothing and
    // keeps what was picked, which is what a retry needs.
    <div key={node.formKey} className="flex flex-col gap-1 p-1">
      {node.discardWarning ? (
        <p role="note" className="mb-0.5 rounded-control bg-warning/12 p-1.5 text-xs text-warning">
          {node.discardWarning}
        </p>
      ) : null}
      {choices.map((choice) => {
        const current = node.state === choice.value;
        return (
          <Form method="post" key={choice.value} autoComplete="off">
            <input type="hidden" name="intent" value="set-report-sharing" />
            <input type="hidden" name="slug" value={node.slug} />
            <input type="hidden" name="sharing" value={choice.value} />
            <Button
              type="submit"
              size="sm"
              variant={current ? "primary" : "secondary"}
              disabled={current}
              className="w-full justify-start text-left"
              title={choice.hint}
            >
              {current ? `✓ ${choice.label}` : choice.label}
            </Button>
          </Form>
        );
      })}
      <p className="mt-1 text-[0.65rem] leading-snug text-subtle">
        Only you can delete this report, in every option above. To set a password or invite specific
        people, use the API or MCP.
      </p>
    </div>
  );
}
