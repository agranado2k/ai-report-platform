import type { ComponentProps } from "react";
import { cx } from "./cx";

// A track+thumb toggle — deliberately unlike the checkbox (rounded-square) and
// the radio (circle) so the three controls never read the same (report §07).
// A visually-hidden native checkbox (`peer`, role="switch") carries the real
// state, focus and form participation; the track/thumb are CSS driven off
// `peer-checked` / `peer-focus-visible`. `type` is pinned; the rest passes
// through to the input so `name`/`checked`/`defaultChecked`/`onChange` work.
export function Switch({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type" | "role" | "className"> & { className?: string }) {
  return (
    <label className={cx("relative inline-flex cursor-pointer items-center", className)}>
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden="true"
        className={
          "h-5 w-9 rounded-full bg-border-strong transition-colors ease-standard duration-150 " +
          "peer-checked:bg-brand peer-disabled:opacity-50 " +
          "peer-focus-visible:ring-[3px] peer-focus-visible:ring-brand-ring " +
          "after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full " +
          "after:bg-surface after:shadow-sm after:transition-transform after:ease-standard after:duration-150 after:content-[''] " +
          "peer-checked:after:translate-x-4 motion-reduce:after:transition-none"
        }
      />
    </label>
  );
}
