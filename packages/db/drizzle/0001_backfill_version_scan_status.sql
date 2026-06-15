-- Custom SQL migration file, put your code below! --

-- Backfill report_versions.scan_status from the authoritative scan_jobs verdict.
--
-- Root cause (fixed in the same PR, report-repository.ts): save() upserted version
-- rows with ON CONFLICT DO NOTHING, so once a row was inserted at upload
-- (scan_status = 'pending') the scan drain's promotion save() never refreshed it.
-- Every promoted version's cached scan_status stayed 'pending' in the DB while
-- reports.live_version_id was set correctly — and the ADR-0038 viewer gate (which
-- requires the live version to be 'clean') then 404'd every promoted report.
--
-- scan_jobs is the source of truth: a 'done' job carries the real terminal verdict.
-- This reconciles the stale cache for clean / flagged / blocked alike. Idempotent:
-- it only touches rows whose cached status actually diverges from the verdict, and
-- versions whose scan never completed (no 'done' job) are left 'pending' correctly.
UPDATE report_versions AS v
SET scan_status = j.verdict
FROM scan_jobs AS j
WHERE j.report_version_id = v.id
  AND j.status = 'done'
  AND j.verdict IS NOT NULL
  AND v.scan_status <> j.verdict;
