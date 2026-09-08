import { Checkbox, cx } from "arp-ui";
import { SCOPE_CARDS } from "./api-keys";

// The scope selection as selectable cards (report §04): each grant is a bordered
// card the whole surface of which is the checkbox label, so the reader sees what
// each scope allows before granting it. The inputs post as repeated `scopes`
// entries — the create action reads them via scopesFromForm and the use case
// re-validates against KEY_ISSUABLE_SCOPES. Presentation only.
const inputId = (id: string) => `scope-${id.replace(/[^a-z]+/gi, "-")}`;

export function ScopeCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {SCOPE_CARDS.map((scope) => {
        const id = inputId(scope.id);
        return (
          <label
            key={scope.id}
            htmlFor={id}
            className={cx(
              "flex cursor-pointer items-start gap-3 rounded-card border border-border bg-surface p-3.5",
              "transition-colors ease-standard duration-150 hover:border-border-strong",
              "has-[:checked]:border-brand has-[:checked]:bg-brand/5",
            )}
          >
            <Checkbox
              id={id}
              name="scopes"
              value={scope.id}
              defaultChecked={scope.defaultChecked}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <code className="font-mono text-xs font-medium text-fg">{scope.title}</code>
              <span className="mt-1 block text-sm text-muted">{scope.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
