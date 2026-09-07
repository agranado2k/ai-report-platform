import { Form } from "@remix-run/react";
import { Button, cx, Input, Select, Textarea, UploadIcon } from "arp-ui";
import { useRef, useState } from "react";
import { deriveTitleFromHtml } from "./upload-title";

/** A destination folder option (report Z0W60dI8hu §03). Wire-encoded id +
 *  display name — the same visible-folder set the dashboard's Move control
 *  offers, so an upload can only target a folder this user can already see. */
export interface UploadFolderOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The upload screen's form (#337, report §03): a drop zone as the PRIMARY path,
 * with the raw-HTML paste textarea RETAINED behind a `<details>` disclosure (the
 * MCP and CLI already produce HTML, and people still paste). Destination folder
 * is chosen here; the Title field defaults to the dropped/pasted document's own
 * `<title>`.
 *
 * Progressive enhancement: the fields are uncontrolled, so the paste path still
 * submits with JavaScript disabled — the drop zone and title-prefill are the
 * enhancement layered on top (they set the same `html`/`title` fields a paste
 * would). The submit is disabled only while a submission is in flight, never on
 * a JS-only "is it empty" check, so a no-JS paste is never locked out.
 */
export function UploadForm({
  folders,
  defaultFolderId,
  busy,
}: {
  folders: readonly UploadFolderOption[];
  defaultFolderId: string;
  busy: boolean;
}) {
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Read a dropped/browsed file into the `html` field, and — only if the user
  // has not already typed a title — seed the Title field from the document's own
  // <title>. readAsText keeps the bytes as UTF-8 text; the real scan/size limits
  // live server-side (ADR-0012), untouched here.
  function ingest(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (htmlRef.current) htmlRef.current.value = text;
      if (titleRef.current && !titleRef.current.value.trim()) {
        titleRef.current.value = deriveTitleFromHtml(text) ?? "";
      }
    };
    reader.readAsText(file);
  }

  return (
    <Form method="post" className="grid max-w-xl gap-5">
      {/* Drop zone — the primary path. A <label> wraps the file input so browse
          works with a plain click; onDrop layers drag-and-drop on top. */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          ingest(e.dataTransfer.files?.[0]);
        }}
        className={cx(
          "grid cursor-pointer place-items-center gap-2.5 rounded-card border border-dashed bg-bg px-5 py-9 text-center transition-colors",
          dragOver ? "border-brand bg-brand-soft" : "border-border-strong hover:border-brand",
        )}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".html,text/html"
          className="sr-only"
          onChange={(e) => ingest(e.currentTarget.files?.[0] ?? undefined)}
        />
        <span className="grid size-11 place-items-center rounded-control border border-border bg-surface text-brand-hover shadow-xs">
          <UploadIcon className="size-6" />
        </span>
        <span className="font-medium text-fg">
          {fileName ? `Selected: ${fileName}` : "Drop an .html file here, or browse"}
        </span>
        <span className="text-[13px] text-muted">Up to 25 MB · one document per upload</span>
      </label>

      <div className="grid gap-1.5">
        <label htmlFor="upload-title" className="text-sm font-medium text-fg">
          Title
        </label>
        <Input
          ref={titleRef}
          id="upload-title"
          name="title"
          placeholder="Defaults to the document's <title>"
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="upload-folder" className="text-sm font-medium text-fg">
          Folder
        </label>
        <Select id="upload-folder" name="folderId" defaultValue={defaultFolderId}>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Paste path — RETAINED behind a disclosure for MCP/CLI users who paste,
          and the no-JS fallback (this textarea posts `html` directly). */}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-muted select-none hover:text-fg">
          Or paste HTML instead
        </summary>
        <Textarea
          ref={htmlRef}
          name="html"
          rows={10}
          aria-label="Report HTML"
          placeholder="<!doctype html> …"
          className="mt-2.5 font-mono text-xs"
        />
      </details>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={busy} loading={busy}>
          {busy ? "Uploading…" : "Upload report"}
        </Button>
        <a
          href="/"
          className="inline-flex h-10 items-center rounded-control px-4 text-sm font-medium text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          Cancel
        </a>
        <span className="flex-1" />
        <span className="text-[13px] text-muted">Reports are private until you share them</span>
      </div>
    </Form>
  );
}
