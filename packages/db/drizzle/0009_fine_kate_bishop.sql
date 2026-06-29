ALTER TYPE "public"."acl_mode" ADD VALUE 'private' BEFORE 'public';--> statement-breakpoint
ALTER TABLE "acls" ALTER COLUMN "mode" SET DEFAULT 'private';