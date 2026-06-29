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
