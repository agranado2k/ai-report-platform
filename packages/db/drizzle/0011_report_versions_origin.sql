CREATE TYPE "public"."version_origin" AS ENUM('upload', 'editor');--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "origin" "version_origin" DEFAULT 'upload' NOT NULL;