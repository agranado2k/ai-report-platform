// Follow a redirect chain to its TERMINAL state, across origins, carrying
// cookies.
//
// WHY THIS EXISTS. The suite kept asserting an INTERMEDIATE hop and stopping.
// `editor-auth.steps.ts` asserted the `303` off `/{slug}/edit?et=…` and went no
// further — and the failure was always on the NEXT request: #188's re-nested
// `/edit` route and the ADR-0080 owner lockout BOTH shipped through that same
// untested hop, twice. An intermediate status is a fact about the middle of a
// journey; what a user experiences is where the journey ENDS. So the rule this
// helper encodes is: assert the terminal state, and assert something about its
// BODY — a bare `200` proved insufficient this week, because the wrong page can
// answer 200 just as happily as the right one.
//
// COOKIES ARE CARRIED FORWARD ACROSS ORIGINS, DELIBERATELY. A browser would
// scope them by domain; this follower does not, because the chains it exists to
// walk are precisely the cross-origin ones — the app origin mints an edit token,
// the view origin exchanges it for an `arp_edit` cookie, and the hop that
// matters is the one that carries that cookie back to the view origin. Scoping
// by domain would drop exactly the credential under test. Only ever point this
// at first-party preview origins.
//
// The `request` parameter is a STRUCTURAL type, not Playwright's
// `APIRequestContext` — `page.request` and the `request` fixture both satisfy
// it, and so does a hand-written fake, which is what lets `follow.test.ts` pin
// the loop/cap/cookie behaviour in the fast node-tier gate.

/** The subset of an `APIResponse` this follower reads. */
export type FollowableResponse = {
  status(): number;
  url(): string;
  headers(): Record<string, string>;
  headersArray(): readonly { name: string; value: string }[];
  text(): Promise<string>;
};

/** The subset of an `APIRequestContext` this follower drives. */
export type FollowableRequest = {
  get(
    url: string,
    options: { headers?: Record<string, string>; maxRedirects?: number },
  ): Promise<FollowableResponse>;
};

/** One request in the chain: where it went, what it answered, where it pointed. */
export type Hop = {
  readonly url: string;
  readonly status: number;
  /** The raw `Location` header, verbatim — `null` on a non-redirect. */
  readonly location: string | null;
};

/** Where the chain actually ended. */
export type TerminalState = {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  /** Every hop, in order. `hops.length === 1` means "no redirect at all". */
  readonly hops: readonly Hop[];
};

export type FollowOptions = {
  /** Sent on EVERY hop. A `Cookie` entry seeds the jar; the chain's own
   *  `Set-Cookie`s then override individual names as they arrive. */
  readonly headers?: Record<string, string>;
  /** Maximum REQUESTS, not redirects. */
  readonly maxHops?: number;
};

const REDIRECT_CODES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Generous enough for any legitimate chain in this product (the longest is
 *  three: `/open` → `/{slug}/edit?et=` → `/{slug}/edit`), tight enough that a
 *  runaway fails in seconds instead of timing the whole scenario out. */
export const DEFAULT_MAX_HOPS = 10;

/** RFC 6265 `cookie-name` (a `token`), anchored so a comma inside an `Expires`
 *  value can never be mistaken for the separator between two folded cookies. */
const COOKIE_NAME = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";

/** Split a `Set-Cookie` header value that may carry SEVERAL cookies folded into
 *  one line. Playwright's `headersArray()` usually keeps them separate, but a
 *  proxy that folds duplicate headers is ordinary enough that assuming
 *  otherwise silently drops the second cookie — which is how `arp_edit_oa`
 *  would go missing. */
function splitFoldedSetCookie(raw: string): readonly string[] {
  return raw.split(new RegExp(`,\\s*(?=${COOKIE_NAME}=)`));
}

/** `name=value; Path=/; HttpOnly` → `["name", "value"]`, or null if unparseable. */
function parseCookiePair(raw: string): readonly [string, string] | null {
  const pair = (raw.split(";")[0] ?? "").trim();
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  return [pair.slice(0, eq), pair.slice(eq + 1)];
}

/** Seed the jar from a caller-supplied `Cookie` request header. */
function seedJar(headers: Record<string, string> | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  const cookieHeader = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === "cookie",
  )?.[1];
  for (const part of (cookieHeader ?? "").split(";")) {
    const parsed = parseCookiePair(part);
    if (parsed) jar.set(parsed[0], parsed[1]);
  }
  return jar;
}

/** Absorb a response's `Set-Cookie`s. An empty value CLEARS the name rather
 *  than replaying `name=` on the next hop — a cleared cookie is the server
 *  saying "you no longer hold this", and echoing it back would misrepresent
 *  what the following request actually carries. */
function absorbSetCookies(jar: Map<string, string>, response: FollowableResponse): void {
  for (const header of response.headersArray()) {
    if (header.name.toLowerCase() !== "set-cookie") continue;
    for (const folded of splitFoldedSetCookie(header.value)) {
      const parsed = parseCookiePair(folded);
      if (!parsed) continue;
      if (parsed[1] === "") jar.delete(parsed[0]);
      else jar.set(parsed[0], parsed[1]);
    }
  }
}

/** Every header for the next hop: the caller's, minus their `Cookie` (the jar
 *  supersedes it), plus the jar if it holds anything. */
function headersForHop(
  callerHeaders: Record<string, string> | undefined,
  jar: ReadonlyMap<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(callerHeaders ?? {})) {
    if (name.toLowerCase() === "cookie") continue;
    out[name] = value;
  }
  if (jar.size > 0) {
    out.Cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  return out;
}

/** The chain so far, rendered for a failure message. A helper that gives up
 *  must say WHERE — "it looped" with no addresses is a second investigation. */
function renderChain(hops: readonly Hop[]): string {
  return hops
    .map((h) => `${h.status} ${h.url}${h.location ? ` → ${h.location}` : ""}`)
    .join("\n  ");
}

/**
 * Walk `startUrl`'s redirect chain until something answers a non-redirect, and
 * return that terminal response.
 *
 * FAILS LOUDLY rather than hanging: a repeated URL is a loop and a chain longer
 * than `maxHops` is a runaway, and both throw with the whole chain in the
 * message. A redirect with no `Location` throws too — silently treating it as
 * terminal would report a 302 as if it were a destination.
 */
export async function followToTerminal(
  request: FollowableRequest,
  startUrl: string,
  options: FollowOptions = {},
): Promise<TerminalState> {
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS;
  const jar = seedJar(options.headers);
  const hops: Hop[] = [];
  const visited = new Set<string>();
  let url = startUrl;

  for (;;) {
    if (hops.length >= maxHops) {
      throw new Error(
        `followToTerminal: still redirecting after ${maxHops} hops from ${startUrl}\n  ${renderChain(hops)}`,
      );
    }
    if (visited.has(url)) {
      throw new Error(
        `followToTerminal: redirect loop — ${url} was already visited\n  ${renderChain(hops)}`,
      );
    }
    visited.add(url);

    const response = await request.get(url, {
      headers: headersForHop(options.headers, jar),
      maxRedirects: 0,
    });
    absorbSetCookies(jar, response);

    const status = response.status();
    const location = response.headers().location ?? null;
    // `startUrl` may be RELATIVE ("/upload") — Playwright resolves it against the
    // context's baseURL, but `new URL(relative, relativeBase)` throws, so the base
    // for the next hop must be the ABSOLUTE url the request actually went to.
    // Taking it from the response rather than tracking a baseURL ourselves keeps
    // the helper working for both relative and cross-origin absolute starts.
    const absolute = response.url() || url;
    hops.push({ url: absolute, status, location });

    if (!REDIRECT_CODES.has(status)) {
      return { status, url: absolute, body: await response.text(), hops };
    }
    if (!location) {
      throw new Error(
        `followToTerminal: ${status} with no Location header at ${absolute} — a redirect that names no destination is a bug, not a terminal state\n  ${renderChain(hops)}`,
      );
    }
    url = new URL(location, absolute).toString();
  }
}
