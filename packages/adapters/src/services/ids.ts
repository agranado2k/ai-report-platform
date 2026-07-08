// IdGenerator adapter — app-side UUIDv7 ids (time-ordered, index-friendly;
// db-design.md says ids originate app-side, no DB default). Boundary layer
// (ADR-0020): the use cases depend on the IdGenerator port, not on uuid.
import type { IdGenerator } from "arp-application";
import {
  type CommentId,
  commentId,
  type FolderId,
  folderId,
  type ReportId,
  reportId,
  type VersionId,
  versionId,
} from "arp-domain";
import { v7 as uuidv7 } from "uuid";

export class UuidV7IdGenerator implements IdGenerator {
  reportId(): ReportId {
    return reportId(uuidv7());
  }

  versionId(): VersionId {
    return versionId(uuidv7());
  }

  folderId(): FolderId {
    return folderId(uuidv7());
  }

  commentId(): CommentId {
    return commentId(uuidv7());
  }

  nonceId(): string {
    return uuidv7();
  }
}
