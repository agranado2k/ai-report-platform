// R2BlobStore — version bundles in Cloudflare R2 via its S3-compatible API,
// signed with aws4fetch (SigV4). Keys follow ADR-0037:
//   reports/<reportId>/<versionId>/<path>
// Boundary layer (ADR-0020). Verified end-to-end against arp-reports-prod.
import type { BlobFile, BlobStore } from "arp-application";
import type { AppError, ReportId, Result, VersionId } from "arp-domain";
import { ok } from "arp-domain";
import { AwsClient } from "aws4fetch";

export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** S3 endpoint, e.g. https://<account>.r2.cloudflarestorage.com */
  readonly endpoint: string;
  /**
   * Optional key namespace prepended to every object key (e.g. "pr-42/") so a
   * preview deployment's blobs are isolated within the bucket. Unset in
   * production — keys then start at `reports/…` unchanged.
   */
  readonly keyPrefix?: string;
}

/** Object key for a file within a version bundle (ADR-0037). */
export function blobKey(reportId: ReportId, versionId: VersionId, path: string): string {
  return `reports/${reportId}/${versionId}/${path}`;
}

/**
 * Prepend an optional key namespace so a preview deployment's objects live under
 * `pr-<N>/…` instead of colliding with production keys. Empty/undefined leaves
 * the key unchanged (production); leading/trailing slashes are normalized.
 */
export function withPrefix(prefix: string | undefined, key: string): string {
  if (!prefix) return key;
  const norm = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return norm ? `${norm}/${key}` : key;
}

export class R2BlobStore implements BlobStore {
  private readonly aws: AwsClient;

  constructor(private readonly cfg: R2Config) {
    this.aws = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: "auto",
      service: "s3",
    });
  }

  private url(key: string): string {
    return `${this.cfg.endpoint.replace(/\/$/, "")}/${this.cfg.bucket}/${key}`;
  }

  async putVersionBundle(
    reportId: ReportId,
    versionId: VersionId,
    files: readonly BlobFile[],
  ): Promise<Result<void, AppError>> {
    try {
      for (const f of files) {
        const res = await this.aws.fetch(
          this.url(withPrefix(this.cfg.keyPrefix, blobKey(reportId, versionId, f.path))),
          {
            method: "PUT",
            // Uint8Array is a valid fetch body at runtime; the cast bridges TS
            // 5.7's generic Uint8Array<ArrayBufferLike> vs BodyInit.
            body: f.bytes as unknown as BodyInit,
            headers: { "content-type": f.contentType },
          },
        );
        if (!res.ok) return r2err("putObject", res.status, await safeText(res));
      }
      return ok(undefined);
    } catch (e) {
      return thrown("putVersionBundle", e);
    }
  }

  async readObject(
    reportId: ReportId,
    versionId: VersionId,
    path: string,
  ): Promise<Result<BlobFile | null, AppError>> {
    try {
      const res = await this.aws.fetch(
        this.url(withPrefix(this.cfg.keyPrefix, blobKey(reportId, versionId, path))),
      );
      if (res.status === 404) return ok(null);
      if (!res.ok) return r2err("getObject", res.status, await safeText(res));
      const bytes = new Uint8Array(await res.arrayBuffer());
      return ok({
        path,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        bytes,
      });
    } catch (e) {
      return thrown("readObject", e);
    }
  }

  async deleteVersionPrefix(
    reportId: ReportId,
    versionId: VersionId,
  ): Promise<Result<void, AppError>> {
    try {
      const prefix = withPrefix(this.cfg.keyPrefix, `reports/${reportId}/${versionId}/`);
      const listUrl = `${this.cfg.endpoint.replace(/\/$/, "")}/${this.cfg.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`;
      const list = await this.aws.fetch(listUrl);
      if (!list.ok) return r2err("listObjects", list.status, await safeText(list));
      const xml = await list.text();
      // R2/S3 ListObjectsV2 returns <Key>…</Key> per object.
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] as string);
      for (const key of keys) {
        const del = await this.aws.fetch(this.url(key), { method: "DELETE" });
        if (!del.ok && del.status !== 404)
          return r2err("deleteObject", del.status, await safeText(del));
      }
      return ok(undefined);
    } catch (e) {
      return thrown("deleteVersionPrefix", e);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}

function r2err(op: string, status: number, body: string): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `R2 ${op} failed (${status}): ${body}` },
  };
}

function thrown(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: {
      kind: "Unexpected",
      message: `R2 ${op}: ${e instanceof Error ? e.message : String(e)}`,
    },
  };
}
