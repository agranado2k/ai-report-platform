import { Form } from "@remix-run/react";
import { Badge, Button, cx } from "arp-ui";
import { formatKeyDate, keyStatus } from "./api-keys";

// The listed keys as a proper table (report §04): name + prefix, scopes,
// created, last used, and a revoke action. A revoked key is dimmed, its scopes
// cell replaced by a Revoked badge, and it carries no revoke control. The revoke
// Form posts intent=revoke with the key id — the same action seam as before;
// this is presentation only.
export type ApiKeyRow = {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
};

const cell = "px-3 py-3 align-top text-sm";
const head = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-subtle";

export function ApiKeysTable({ keys, busy }: { keys: readonly ApiKeyRow[]; busy: boolean }) {
  if (keys.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-sm text-muted">
        No keys yet. Create one above.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full border-collapse text-left">
        <thead className="border-b border-border bg-surface-raised">
          <tr>
            <th className={head}>Key</th>
            <th className={head}>Scopes</th>
            <th className={head}>Created</th>
            <th className={head}>Last used</th>
            <th className={cx(head, "text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const revoked = keyStatus(key.revokedAt) === "revoked";
            return (
              <tr
                key={key.id}
                className={cx(
                  "border-b border-border last:border-0 bg-surface",
                  revoked ? "opacity-60" : null,
                )}
              >
                <td className={cell}>
                  <div className="font-medium text-fg">{key.name}</div>
                  <code className="font-mono text-xs text-subtle">
                    {key.keyPrefix}&bull;&bull;&bull;&bull;
                  </code>
                </td>
                <td className={cell}>
                  {revoked ? (
                    <Badge tone="danger">Revoked</Badge>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} tone="neutral" className="font-mono">
                          {scope}
                        </Badge>
                      ))}
                    </span>
                  )}
                </td>
                <td className={cx(cell, "whitespace-nowrap text-muted")}>
                  {formatKeyDate(key.createdAt)}
                </td>
                <td className={cx(cell, "whitespace-nowrap text-muted")}>
                  {formatKeyDate(key.lastUsedAt)}
                </td>
                <td className={cx(cell, "text-right")}>
                  {revoked ? null : (
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="id" value={key.id} />
                      <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                        Revoke
                      </Button>
                    </Form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
