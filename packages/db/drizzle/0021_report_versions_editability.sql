-- ADR-0080 — record the editor's open-time verdict on a version's stored bytes.
--
-- BACKFILL POLICY (behaviour-neutral, deliberately): the column is NULLABLE
-- with NO default, so every pre-existing row reads UNKNOWN. A migration cannot
-- read R2, so any default it wrote would be a verdict nobody ran — and
-- 'editable' would be a lie for exactly the reports this ADR exists to find,
-- while 'unsplittable' would make every existing report announce itself as
-- un-editable. UNKNOWN is never treated as un-editable: the editor keeps
-- attempting and degrading, which is precisely today's behaviour. Versions are
-- re-probed as they are re-uploaded; there is no sweep.
CREATE TYPE "public"."version_editability" AS ENUM('editable', 'unsplittable', 'unparsable');--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "editability" "version_editability";
