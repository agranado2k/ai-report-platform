// The client-only ProseMirror editor surface (ADR-0062). Mounted in a
// `useEffect` because `EditorView` needs a real DOM — Remix SSR must never
// try to construct one. No toolbar (editor MVP scope): typing plus the
// Mod-b / Mod-i / Mod-z keymap bindings from `editorPlugins()` are the whole
// interaction surface. The pure state/keymap wiring lives in
// `../editor/editor-state` (unit-tested there); this component only owns the
// DOM mount/teardown and forwards doc-changed events to the caller.
import type { PMDocJson } from "arp-report-html";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef } from "react";
import { createEditorState, docJson } from "../editor/editor-state";

export interface ReportEditorProps {
  /** The document to open — the lossless `_source.json` sidecar, or a
   *  best-effort HTML→PM parse when none exists yet (ADR-0062 §4). Read only
   *  at mount: the editor owns its own state thereafter. */
  readonly initialDoc: PMDocJson;
  /** Fired after every transaction that changes the document, with the
   *  current doc as PM JSON — the caller keeps the latest value (a ref is
   *  enough; no need to re-render on every keystroke) for Save. */
  readonly onChange: (doc: PMDocJson) => void;
  readonly className?: string;
}

export function ReportEditor({ initialDoc, onChange, className }: ReportEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialDoc is read only at mount by design (see the prop doc-comment) — the parent remounts via a `key` change (e.g. the slug) to load a genuinely different document.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView(host, {
      state: createEditorState(initialDoc),
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) onChangeRef.current(docJson(next));
      },
    });

    return () => view.destroy();
  }, []);

  return <div ref={hostRef} className={className} />;
}
