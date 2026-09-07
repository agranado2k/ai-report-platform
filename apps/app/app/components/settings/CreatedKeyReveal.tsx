import { AlertTriangleIcon, Badge, Banner } from "arp-ui";
import { CopyButton } from "../CopyButton";
import type { CreatedKey } from "./api-keys";

// The one-time secret reveal (report §04). We store only the key's HMAC, so the
// plaintext can never be shown again — the reveal gets the warning treatment it
// deserves (a warning Banner), the secret verbatim with a copy button, and the
// granted scopes for confirmation. Rendered only on a create success (see
// createdKeyView); a revoke/error/replay renders nothing.
export function CreatedKeyReveal({ created }: { created: CreatedKey }) {
  return (
    <Banner
      tone="warning"
      icon={<AlertTriangleIcon />}
      title="Copy your new key now"
      className="mt-4"
    >
      <p>It is shown once. If you lose it, revoke it and create another.</p>
      <div className="mt-2 flex items-center gap-3 rounded-control border border-warning/40 bg-bg p-3">
        <code className="overflow-x-auto font-mono text-xs text-fg">{created.secret}</code>
        <CopyButton value={created.secret} className="ml-auto shrink-0" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-subtle">{created.name}</span>
        <span aria-hidden className="text-subtle">
          ·
        </span>
        {created.scopes.map((scope) => (
          <Badge key={scope} tone="brand" className="font-mono">
            {scope}
          </Badge>
        ))}
      </div>
    </Banner>
  );
}
