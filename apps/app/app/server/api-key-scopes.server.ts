// Boundary decode for the settings create-key form's scope selection
// (ADR-0016). Checkbox groups submit as repeated `scopes` entries; coerce
// each to a string VERBATIM — no filtering, no defaulting. Validation (known
// members, non-empty, the issuable subset) belongs to the createApiKey use
// case (`makeScopes` against `KEY_ISSUABLE_SCOPES`), so a tampered or empty
// selection still surfaces as the 422 it should, from the one enforcement
// path both the browser form and any future API caller share.
export function scopesFromForm(form: FormData): readonly string[] {
  return form.getAll("scopes").map(String);
}
