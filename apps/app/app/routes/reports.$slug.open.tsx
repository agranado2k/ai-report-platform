// GET /reports/{slug}/open — the ONE mint (ADR-0056, ADR-0059 §4). The viewer
// origin is credential-free and cannot recognise anyone, so this route — which
// holds the Clerk session — is where every capability for an authenticated
// viewer surface is issued, after `loadWritableReport` proves `canWrite`
// (owner OR write-grantee). Untrusted report HTML still renders only on the
// view origin. The decision itself lives in open-report.server.ts (unit-tested
// with injected fakes); this route is the thin transport shell.
//
// It hands back a redirect carrying an `Edit token` (`et=`) plus exactly one
// read capability, chosen by ownership: an owner gets the `owner:true` Access
// token (`oa=`), a canWrite non-owner gets a `Grantee read token` (`gr=`,
// ADR-0091). Minting `owner:true` for a non-owner would be the review-#146
// privilege escalation, so the two are mutually exclusive by construction.
//
// WHERE it sends them is `?to=` (#363): the OWNER VIEW by default — ADR-0089's
// first-party chrome above the byte-for-byte report — and the editor only when
// asked for by name. Before that flip every canWrite user landed in the editor,
// which is why an owner clicked Edit when they wanted to look at their own
// report and got the `Report HTML schema`'s reduction of it instead.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { resolveActorForRead } from "../server/auth.server";
import {
  accessTokenSecret,
  deps,
  identityStore,
  orgWriteGrantStore,
  viewOrigin,
  writeGrantStore,
} from "../server/container.server";
import { log } from "../server/log.server";
import { ownerOpenLocation } from "../server/open-report.server";

export async function loader(args: LoaderFunctionArgs) {
  // No session / not provisioned / infra error → the decision collapses to "/"
  // (the root gate sends anonymous users to sign-in). We never reveal whether
  // the report exists.
  const actor = await resolveActorForRead(args);

  const location = await ownerOpenLocation(
    {
      reports: deps().reports,
      now: () => Date.now(),
      log: (f, m) => log.info(f, m),
      writeGrant: {
        grants: writeGrantStore(),
        orgWriteGrants: orgWriteGrantStore(),
        identities: identityStore(),
      },
    },
    {
      actor: actor.ok ? actor.value : null,
      rawHandle: String(args.params.slug ?? ""),
      viewOrigin: viewOrigin(args.request),
      secret: accessTokenSecret(),
      // `?to=edit` asks for the editor; anything else (including nothing, a
      // typo, or a hostile value) resolves to the OWNER VIEW (#363). An
      // allow-list of one rather than a cast, so the query string can only ever
      // select between two known surfaces and never reach the URL builder as
      // free text. It is not an authorization input: `loadWritableReport` gates
      // both destinations identically, so the worst a bad value can do is land
      // a canWrite user on the default surface.
      destination:
        new URL(args.request.url).searchParams.get("to") === "edit" ? "editor" : "ownerView",
    },
  );
  return redirect(location, { headers: { "cache-control": "no-store" } });
}
