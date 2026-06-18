DROP INDEX "folders_org_parent_slug_uniq";--> statement-breakpoint
DROP INDEX "folders_org_root_slug_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "folders_org_parent_slug_uniq" ON "folders" USING btree ("org_id","parent_id","slug") WHERE "folders"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_org_root_slug_uniq" ON "folders" USING btree ("org_id","slug") WHERE "folders"."parent_id" is null and "folders"."deleted_at" is null;