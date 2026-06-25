// resolveAccessDecision — the viewer's access gate for a private report (ADR-0056).
// Pure + mode-agnostic: a public report always serves; a private one (password/org/
// allowlist) serves only with a valid access token, supplied either as the `?access`
// hand-off from the app (→ grant: set the unlock cookie) or as an already-set unlock
// cookie (→ serve). No valid token → unlock: redirect to the app to authorize. The
// app is where mode-specific auth happens; the viewer never holds Clerk creds.
import { type Acl, isPrivateAcl, verifyAccessToken } from "arp-domain";

export type AccessDecision =
  | { readonly kind: "serve" }
  | { readonly kind: "grant"; readonly token: string }
  | { readonly kind: "unlock" };

export function resolveAccessDecision(
  acl: Acl,
  tokens: { readonly cookie?: string; readonly query?: string },
  slug: string,
  secret: string,
  nowSeconds: number,
): AccessDecision {
  if (!isPrivateAcl(acl)) return { kind: "serve" };
  // Fail closed when the secret is unset (previews/dev): Node's HMAC accepts an empty
  // key, so without this an attacker could forge `payload.HMAC("",payload)` and the
  // verify below would pass. No secret ⇒ unverifiable ⇒ unlock (claude-review #100).
  if (!secret) return { kind: "unlock" };
  // The app's one-time `?access` hand-off — verify, then signal the loader to set
  // the unlock cookie so the rest of the bundle (relative-URL assets) is gated too.
  if (tokens.query && verifyAccessToken(tokens.query, slug, secret, nowSeconds)) {
    return { kind: "grant", token: tokens.query };
  }
  if (tokens.cookie && verifyAccessToken(tokens.cookie, slug, secret, nowSeconds)) {
    return { kind: "serve" };
  }
  return { kind: "unlock" };
}
