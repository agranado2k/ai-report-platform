ALTER TABLE "reports" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
-- Backfill owner_id from the v1 uploader (ADR-0059: the creator is the owner,
-- in every org type). Every report has a v1 version created atomically in
-- createReport, so this covers every row — including soft-deleted reports,
-- deliberately not filtered by deleted_at, since ownership is a data property
-- (not a listing concern) and the column is about to become NOT NULL.
UPDATE "reports" AS r
SET "owner_id" = v."uploaded_by_user"
FROM "report_versions" AS v
WHERE v."report_id" = r."id"
  AND v."version_no" = 1;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_owner_id_idx" ON "reports" USING btree ("owner_id");
