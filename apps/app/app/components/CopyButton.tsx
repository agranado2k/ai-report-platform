import { CheckIcon, CopyIcon, cx } from "arp-ui";
import { useState } from "react";

/**
 * Copy a string to the clipboard with brief "Copied" feedback. Client-only
 * (navigator.clipboard); silently no-ops where the API is unavailable (insecure
 * context / denied permission). Bundled JS under `script-src 'self'` — CSP-safe.
 */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — leave the value visible for manual selection.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? "Copied" : `${label} to clipboard`}
      className={cx(
        "inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
        copied ? "text-success" : "text-subtle hover:text-brand",
        className,
      )}
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}
