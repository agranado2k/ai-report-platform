// Lint-lite structural check on docs/api/openapi.yaml: confirms the document
// exists and contains the tokens the upload/serve contract requires (version,
// the reports route, the Idempotency-Key header, problem+json error responses,
// the ADR-0040 status codes, and the machine-readable `code` registry).
// Full schema validation (Spectral/Redocly) is a deferred enhancement.

export const id = 'openapi-structure';

export function run(ctx) {
  const out = [];
  const rel = ctx.paths.openapi;
  const text = ctx.read(rel);

  if (text == null) {
    out.push({ validator: id, file: rel, rule: 'openapi-missing', message: 'docs/api/openapi.yaml does not exist', hint: 'Author the OpenAPI 3.1 document (ADR-027).' });
    return out;
  }

  for (const token of ctx.config.openapi.mustContain) {
    if (!text.includes(token)) {
      out.push({
        validator: id,
        file: rel,
        rule: 'openapi-missing-token',
        message: `Required token "${token}" not found in the OpenAPI document`,
        hint: ctx.config.openapi.hints?.[token] ?? 'Add it per ADR-0037..0040.',
      });
    }
  }

  return out;
}
