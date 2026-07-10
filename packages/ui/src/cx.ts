/** Tiny class combiner (no clsx dep): joins truthy class strings. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
