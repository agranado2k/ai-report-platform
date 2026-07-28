// GET /reports/{slug}/open — the OWNER's one-click way into their own report
// (ADR-0056, ADR-0059 §4). The viewer is credential-free and can't recognise an
// owner, so the app (which holds the Clerk session) mints a short-lived `owner`
// access token — ONLY when the report's ownerId equals the acting user (org
// membership is NOT enough) — and hands the owner to the viewer with `?access=`,
// bypassing the share gate. Untrusted report HTML still renders only on the
// view origin. The decision itself lives in open-report.server.ts (unit-tested
// with injected fakes); this route is the thin transport shell.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { resolveActorForRead } from "../server/auth.server";
import {
  accessTokenSecret,
  deps,
  identityStore,
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
      writeGrant: { grants: writeGrantStore(), identities: identityStore() },
    },
    {
      actor: actor.ok ? actor.value : null,
      rawHandle: String(args.params.slug ?? ""),
      viewOrigin: viewOrigin(args.request),
      secret: accessTokenSecret(),
    },
  );
  return redirect(location, { headers: { "cache-control": "no-store" } });
}
