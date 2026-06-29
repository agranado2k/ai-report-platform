// GET /reports/{slug}/open — the OWNER's one-click way into their own report (ADR-0056).
// The viewer is credential-free and can't recognise an owner, so the app (which holds the
// Clerk session) mints a short-lived `owner` access token here — only after getReport proves
// the signed-in org owns the report — and hands the owner to the viewer with `?access=`,
// bypassing the share gate. Untrusted report HTML still renders only on the view origin.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getReport } from "arp-application";
import { mintAccessToken } from "arp-domain";
import { resolveActorForRead } from "../server/auth.server";
import { accessTokenSecret, deps, viewOrigin } from "../server/container.server";
import { resolveReportSlug } from "../server/report-handle.server";

const OWNER_TTL_SECONDS = 86_400; // 24h owner view-session

export async function loader(args: LoaderFunctionArgs) {
  // No session / not provisioned / infra error → bounce to the dashboard (the root gate
  // sends anonymous users to sign-in). We never reveal whether the report exists.
  const actor = await resolveActorForRead(args);
  if (!actor.ok || !actor.value) return redirect("/");

  const slug = await resolveReportSlug(String(args.params.slug ?? ""), deps().reports);
  if (!slug.ok) return redirect("/");

  const origin = viewOrigin(args.request);
  const secret = accessTokenSecret();
  // Private viewing not configured (previews/dev): fall through to the gated viewer.
  if (!secret) return redirect(`${origin}/${slug.value}`);

  // Org-ownership gate: getReport returns the report ONLY when it belongs to the actor's
  // org, so a non-owner can never mint an owner token. Any failure → dashboard.
  const report = await getReport(
    { reports: deps().reports },
    { orgId: actor.value.orgId },
    { slug: slug.value },
  );
  if (!report.ok) return redirect("/");

  const token = mintAccessToken(
    slug.value,
    OWNER_TTL_SECONDS,
    secret,
    Math.floor(Date.now() / 1000),
    {
      owner: true,
    },
  );
  return redirect(`${origin}/${slug.value}?access=${encodeURIComponent(token)}`, {
    headers: { "cache-control": "no-store" },
  });
}
