import type { ComponentProps } from "react";

/**
 * Inline SVG icon set (replaces the prior emoji glyphs). Each icon inherits
 * `currentColor` and is sized via className (e.g. `h-4 w-4`). Decorative by
 * default (`aria-hidden`) — give the interactive parent an accessible label.
 * Inline SVG is CSP-safe (not script); no icon-library runtime dep (ADR-0050).
 */
type IconProps = ComponentProps<"svg">;

function Icon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

/** Upload — tray with an up-arrow. */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </Icon>
  );
}

/** API key — used for the "API keys & MCP" account-menu item. */
export function KeyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 7a4 4 0 1 1-3.5 6L7 17l-2-.5L4.5 14 9 9.5A4 4 0 0 1 15 7z" />
      <path d="M15.5 8.5h.01" />
    </Icon>
  );
}

/** Document — a report row's leading glyph (and its open affordance). */
export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 13h6M9 17h4" />
    </Icon>
  );
}

/** Folder — replaces the 📁 emoji in the tree + per-report folder tag. */
export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z" />
    </Icon>
  );
}

/** Overflow / "more actions" — the kebab that opens a row's action menu. */
export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props} strokeWidth="2.4">
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </Icon>
  );
}

/** Copy — clipboard affordance (endpoints, secrets). */
export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </Icon>
  );
}

/** Check — copied/created confirmation. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

/** Edit — pencil glyph, the dashboard's entry point into the report editor (ADR-0062). */
export function EditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

/** History — clock with a back-arrow sweep, the dashboard's entry point into a
 *  report's version history + visual diff (ADR-0065). */
export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </Icon>
  );
}
