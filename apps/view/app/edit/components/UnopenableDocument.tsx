// The page `/{slug}/edit` renders when the visitor's edit capability is valid
// but the report's stored document cannot be opened by the editor
// (`../unopenable.ts` — the copy, the status and the rationale live there).
//
// It replaces a silent `302` to the read-only viewer, which for a PRIVATE
// report bounced the OWNER onward to the app's unlock page and denied them
// (the 2026-08-06 lockout). This page has no `Location`, so that route does not
// exist; and unlike the redirect, it says why.
//
// Deliberately chrome-free: no TopBar, no Save, no panel. Every one of those
// acts on an editor session that did not start. The only forward action is the
// read-only view of the same report.
import type { UnopenableDocumentPayload } from "../unopenable";

export function UnopenableDocument({ data }: { readonly data: UnopenableDocumentPayload }) {
  const { explanation, readOnlyHref } = data.unopenable;
  return (
    <main
      className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 py-16"
      // The e2e / dogfood signal that THIS branch rendered rather than the
      // editor — the mirror of the editor's own `unified-editor` testid.
      data-testid="editor-unopenable"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-subtle">Centaur Spec</p>
      <h1 className="text-xl font-semibold text-fg">This report can’t be opened in the editor</h1>
      <p className="truncate text-sm text-subtle">{data.docTitle}</p>
      <p className="text-sm text-fg">{explanation}</p>
      <p className="text-sm">
        <a className="font-medium underline" href={readOnlyHref}>
          Open the read-only view
        </a>
      </p>
    </main>
  );
}
