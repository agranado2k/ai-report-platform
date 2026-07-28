CREATE TYPE "public"."org_kind" AS ENUM('personal', 'team');--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "kind" "org_kind" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
CREATE INDEX "orgs_kind_idx" ON "orgs" USING btree ("kind");