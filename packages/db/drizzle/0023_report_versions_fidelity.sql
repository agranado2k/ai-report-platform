CREATE TYPE "public"."version_fidelity" AS ENUM('lossless', 'lossy');--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "fidelity" "version_fidelity";