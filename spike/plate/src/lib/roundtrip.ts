import { createSlateEditor } from "platejs";
import { serializeHtml } from "platejs/static";

export interface RoundtripResult {
  input: string;
  value: unknown;
  output: string;
}

export interface RoundtripOptions {
  /** Maps plugin key -> static React component override (see generic-plugin.tsx). */
  components?: Record<string, any>;
}

/**
 * Import an HTML fragment string into a fresh editor built from `plugins`,
 * then immediately export it back out to HTML.
 *
 * This is the "import -> editable model -> export" pipeline the spike is
 * evaluating, run fully headless (no React mount / no contentEditable).
 *
 * We pass the HTML string directly as `value` (Plate deserializes it during
 * `editor.tf.init`) with `shouldNormalizeEditor: true` so Slate's normalizer
 * runs on the imported content — this is what happens for real when content
 * lands in a live, mounted editor (e.g. via paste), and it matters: e.g. a
 * bare inline node with no block wrapper gets auto-wrapped in a paragraph,
 * and a list item's content gets wrapped in the required "lic" node. Without
 * normalization those invariants are silently left unenforced.
 */
export async function roundtripHtml(
  html: string,
  plugins: any[],
  options: RoundtripOptions = {},
): Promise<RoundtripResult> {
  const editor = createSlateEditor({
    plugins,
    value: html,
    shouldNormalizeEditor: true,
    components: options.components,
  });

  const output = await serializeHtml(editor);

  return { input: html, value: editor.children, output };
}

/**
 * Same as roundtripHtml, but strips Plate's own `slate-*` classes and
 * `data-slate-*` attributes from the output so it can be fairly diffed
 * against the original semantic HTML (Plate's default static renderer
 * decorates every node heavily; see "Export cleanliness" in the report).
 */
export async function roundtripHtmlClean(
  html: string,
  plugins: any[],
  preserveClassNames: string[] = [],
  options: RoundtripOptions = {},
): Promise<RoundtripResult> {
  const editor = createSlateEditor({
    plugins,
    value: html,
    shouldNormalizeEditor: true,
    components: options.components,
  });

  const output = await serializeHtml(editor, {
    stripClassNames: true,
    stripDataAttributes: true,
    preserveClassNames,
  });

  return { input: html, value: editor.children, output };
}
