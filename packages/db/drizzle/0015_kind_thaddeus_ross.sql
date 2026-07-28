CREATE TYPE "public"."comment_intent" AS ENUM('note', 'enhancement', 'add', 'remove');--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "intent" "comment_intent" DEFAULT 'note' NOT NULL;