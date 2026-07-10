// Pure data-assembly for the `/<slug>/edit` route's loader (unified-experience
// epic). Factored out so the "never crash the editor over a Comments/Versions
// load hiccup" degrade-gracefully rule is unit-testable without a Request/
// Response — mirrors ../server/edit-session.ts's role for the auth decision.
// A `listComments`/`listVersions` failure (network blip, a transient 5xx)
// degrades to an EMPTY list, exactly like the loader's other "can't load
// this bit, don't break the page" fallbacks (resolveViewableReport's
// non-"serve" outcomes) — the editor still opens with the document itself,
// just with empty Comments/Versions tabs until the next successful load.
import type { ListCommentsResult } from "./comments-client";
import type { ListVersionsResult } from "./versions-client";
import type { CommentWire, VersionWire } from "./wire-types";

export interface EditLoaderExtras {
  readonly comments: readonly CommentWire[];
  readonly versions: readonly VersionWire[];
}

export function buildEditLoaderExtras(
  commentsResult: ListCommentsResult,
  versionsResult: ListVersionsResult,
): EditLoaderExtras {
  return {
    comments: commentsResult.ok ? commentsResult.comments : [],
    versions: versionsResult.ok ? versionsResult.versions : [],
  };
}
