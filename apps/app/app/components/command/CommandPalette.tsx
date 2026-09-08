import { useNavigate } from "@remix-run/react";
import {
  CopyIcon,
  cx,
  DocumentIcon,
  FolderIcon,
  Kbd,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from "arp-ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { openModal } from "../dialog";
import { makeToast, TOAST_EVENT } from "../feedback/toast";
import { OPEN_NEW_FOLDER_EVENT } from "../folders/NewFolderDialog";
import {
  buildPaletteItems,
  filterPalette,
  isPaletteOpenChord,
  moveActiveIndex,
  opensInNewTab,
  type PaletteFolder,
  type PaletteGroup,
  type PaletteItem,
  type PaletteReport,
} from "./command-palette";

// The ⌘K command palette island (#336, report Z0W60dI8hu §08): a native <dialog>
// (640px) over a filtered listbox that searches reports + folders and exposes
// three actions — upload, new folder, copy MCP endpoint. The model (items,
// filter, chord, ⌘Enter, wrapping nav) is pure and unit-tested in
// command-palette.ts; this is the thin interactive wrapper. ⌘K opens it in the
// app; inside the editor ⌘K stays the link shortcut and the palette moves to
// ⌘⌥K (`inEditor`), the way GitHub resolves the same clash.

const GROUP_LABELS: Record<PaletteGroup, string> = {
  actions: "Actions",
  reports: "Reports",
  folders: "Folders",
};

function itemIcon(item: PaletteItem): ReactNode {
  if (item.action === "upload") return <UploadIcon />;
  if (item.action === "new-folder") return <PlusIcon />;
  if (item.action === "copy-mcp") return <CopyIcon />;
  if (item.group === "reports") return <DocumentIcon />;
  return <FolderIcon />;
}

export function CommandPalette({
  reports,
  folders,
  mcpEndpoint,
  inEditor = false,
}: {
  reports: readonly PaletteReport[];
  folders: readonly PaletteFolder[];
  mcpEndpoint: string;
  inEditor?: boolean;
}) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => buildPaletteItems({ reports, folders }), [reports, folders]);
  const filtered = useMemo(() => filterPalette(items, query), [items, query]);

  // The open chord — global. ⌘K (app) / ⌘⌥K (editor). Opening resets the query
  // and selection so the palette always starts fresh at the top.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteOpenChord(e, { inEditor })) return;
      e.preventDefault();
      setQuery("");
      setActive(0);
      setOpen(true);
      // Guard: ⌘K while the palette is already open would throw on a second
      // showModal() (InvalidStateError). openModal opens only when closed.
      openModal(dialogRef.current);
      // Focus the field after the dialog paints.
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inEditor]);

  const close = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  const activate = (item: PaletteItem | undefined, newTab: boolean) => {
    if (!item) return;
    close();
    if (item.action === "upload") {
      navigate("/upload");
      return;
    }
    if (item.action === "new-folder") {
      window.dispatchEvent(new CustomEvent(OPEN_NEW_FOLDER_EVENT));
      return;
    }
    if (item.action === "copy-mcp") {
      void navigator.clipboard
        ?.writeText(mcpEndpoint)
        .then(() =>
          window.dispatchEvent(
            new CustomEvent(TOAST_EVENT, {
              detail: makeToast({ title: "MCP endpoint copied", description: mcpEndpoint }),
            }),
          ),
        )
        .catch(() => {});
      return;
    }
    if (item.href) {
      if (item.newTab && newTab) window.open(item.href, "_blank", "noopener");
      else navigate(item.href);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => moveActiveIndex(i, 1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => moveActiveIndex(i, -1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(filtered[active], opensInNewTab(e));
    }
  };

  const activeId = filtered[active] ? `palette-opt-${filtered[active].id}` : undefined;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onClose={() => setOpen(false)}
      className={cx(
        "m-auto w-[640px] max-w-[calc(100vw-2rem)] rounded-card border border-border bg-surface p-0 text-fg shadow-lg",
        "backdrop:bg-[rgb(20_24_40/0.45)]",
      )}
    >
      <div>
        <div className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
          <SearchIcon className="size-5 shrink-0 text-placeholder" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls="palette-listbox"
            aria-activedescendant={activeId}
            aria-label="Search reports, folders and actions"
            placeholder="Search reports, folders, and actions…"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onListKeyDown}
            className="h-full flex-1 border-0 bg-transparent text-sm text-fg outline-none placeholder:text-placeholder"
          />
          <Kbd>esc</Kbd>
        </div>

        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No matches.</p>
        ) : (
          <div
            id="palette-listbox"
            role="listbox"
            aria-label="Results"
            className="max-h-[60vh] overflow-y-auto p-2"
          >
            {filtered.map((item, i) => {
              const showHeader = i === 0 || filtered[i - 1]?.group !== item.group;
              return (
                <div key={item.id} className="contents">
                  {showHeader ? (
                    <div className="px-2 pt-2 pb-1 text-[11.5px] font-medium tracking-wide text-muted uppercase">
                      {GROUP_LABELS[item.group]}
                    </div>
                  ) : null}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the combobox
                      input owns keyboard activation (onListKeyDown → Enter);
                      the row's click is the mouse affordance for the same action. */}
                  <div
                    id={`palette-opt-${item.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={(e) => activate(item, opensInNewTab(e))}
                    className={cx(
                      "flex h-9 cursor-pointer items-center gap-2.5 rounded-control px-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0",
                      i === active
                        ? "bg-brand-soft text-brand-hover [&_svg]:text-brand-hover"
                        : "text-fg [&_svg]:text-muted",
                    )}
                  >
                    {itemIcon(item)}
                    <span className="truncate">{item.label}</span>
                    {item.hint ? (
                      <code className="ml-auto truncate font-mono text-xs text-subtle">
                        {item.hint}
                      </code>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> new tab
          </span>
        </div>
      </div>
    </dialog>
  );
}
