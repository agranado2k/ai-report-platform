CREATE TYPE "public"."folder_visibility" AS ENUM('private', 'org');--> statement-breakpoint
CREATE TABLE "folder_shares" (
	"folder_id" uuid NOT NULL,
	"grantee_email" text NOT NULL,
	"grantee_user_id" uuid,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folder_shares_folder_id_grantee_email_pk" PRIMARY KEY("folder_id","grantee_email")
);
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
-- Backfill (ADR-0076): every EXISTING folder becomes org-visible with a NULL
-- (legacy) owner — exactly today's behavior, so nothing disappears from any
-- member's tree at deploy time. Adding the column with DEFAULT 'org' rewrites
-- existing rows in one pass; the default is then flipped to 'private' as the
-- fail-safe for raw inserts (app code always writes an explicit visibility —
-- new folders private/inherited, Root always 'org').
ALTER TABLE "folders" ADD COLUMN "visibility" "folder_visibility" DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ALTER COLUMN "visibility" SET DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_shares_grantee_email_idx" ON "folder_shares" USING btree ("grantee_email");--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_owner_id_idx" ON "folders" USING btree ("owner_id");