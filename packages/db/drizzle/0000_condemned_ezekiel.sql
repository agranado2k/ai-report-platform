CREATE TYPE "public"."abuse_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."acl_mode" AS ENUM('public', 'password', 'org', 'allowlist');--> statement-breakpoint
CREATE TYPE "public"."grant_level" AS ENUM('editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."idempotency_state" AS ENUM('in_flight', 'completed');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."scan_job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'flagged', 'blocked');--> statement-breakpoint
CREATE TABLE "abuse_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"reporter_ip_hash" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"status" "abuse_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"actioned_by" uuid,
	"actioned_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "acls" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"mode" "acl_mode" DEFAULT 'public' NOT NULL,
	"password_hash" text,
	"allowed_emails" jsonb,
	"csp_extras" jsonb,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"acting_user_id" uuid NOT NULL,
	"issued_in_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"meta_json" jsonb NOT NULL,
	"ip_hash" text,
	"geo" text,
	"at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csp_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_slug" text NOT NULL,
	"document_uri" text NOT NULL,
	"violated_directive" text NOT NULL,
	"blocked_uri" text NOT NULL,
	"source_file" text,
	"line_no" integer,
	"raw" jsonb NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder_collaborators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"folder_id" uuid NOT NULL,
	"grantee_user_id" uuid,
	"grantee_email" text NOT NULL,
	"permission" "grant_level" NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"acting_user_id" uuid NOT NULL,
	"route" text NOT NULL,
	"key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"state" "idempotency_state" DEFAULT 'in_flight' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_acting_user_id_route_key_pk" PRIMARY KEY("acting_user_id","route","key")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"plan_limits_json" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "report_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"uploaded_by_user" uuid NOT NULL,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"slug" varchar(10) NOT NULL,
	"title" text NOT NULL,
	"live_version_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "scan_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_version_id" uuid NOT NULL,
	"status" "scan_job_status" DEFAULT 'queued' NOT NULL,
	"verdict" "scan_status",
	"findings" jsonb,
	"started_at" timestamp (3) with time zone,
	"finished_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_actioned_by_users_id_fk" FOREIGN KEY ("actioned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acls" ADD CONSTRAINT "acls_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_issued_in_org_id_orgs_id_fk" FOREIGN KEY ("issued_in_org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_collaborators" ADD CONSTRAINT "folder_collaborators_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_collaborators" ADD CONSTRAINT "folder_collaborators_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_collaborators" ADD CONSTRAINT "folder_collaborators_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_uploaded_by_user_users_id_fk" FOREIGN KEY ("uploaded_by_user") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_live_version_id_report_versions_id_fk" FOREIGN KEY ("live_version_id") REFERENCES "public"."report_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_report_version_id_report_versions_id_fk" FOREIGN KEY ("report_version_id") REFERENCES "public"."report_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abuse_reports_report_id_idx" ON "abuse_reports" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "abuse_reports_status_idx" ON "abuse_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "abuse_reports_created_at_idx" ON "abuse_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_acting_user_id_idx" ON "api_keys" USING btree ("acting_user_id");--> statement-breakpoint
CREATE INDEX "api_keys_last_used_at_idx" ON "api_keys" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "csp_reports_violated_directive_idx" ON "csp_reports" USING btree ("violated_directive");--> statement-breakpoint
CREATE INDEX "csp_reports_received_at_idx" ON "csp_reports" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "folder_collaborators_folder_id_idx" ON "folder_collaborators" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folder_collaborators_grantee_email_idx" ON "folder_collaborators" USING btree ("grantee_email");--> statement-breakpoint
CREATE UNIQUE INDEX "folder_collaborators_folder_email_uniq" ON "folder_collaborators" USING btree ("folder_id","grantee_email");--> statement-breakpoint
CREATE INDEX "folders_org_id_idx" ON "folders" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_org_parent_slug_uniq" ON "folders" USING btree ("org_id","parent_id","slug");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_clerk_org_id_uniq" ON "orgs" USING btree ("clerk_org_id");--> statement-breakpoint
CREATE INDEX "orgs_plan_idx" ON "orgs" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "outbox_status_available_at_idx" ON "outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_id_idx" ON "outbox" USING btree ("aggregate_id");--> statement-breakpoint
CREATE INDEX "report_versions_report_id_idx" ON "report_versions" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_versions_report_version_uniq" ON "report_versions" USING btree ("report_id","version_no");--> statement-breakpoint
CREATE INDEX "report_versions_scan_status_idx" ON "report_versions" USING btree ("scan_status");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_slug_uniq" ON "reports" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "reports_org_folder_idx" ON "reports" USING btree ("org_id","folder_id");--> statement-breakpoint
CREATE INDEX "reports_deleted_at_idx" ON "reports" USING btree ("deleted_at") WHERE "reports"."deleted_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_jobs_report_version_uniq" ON "scan_jobs" USING btree ("report_version_id");--> statement-breakpoint
CREATE INDEX "scan_jobs_status_idx" ON "scan_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_id_uniq" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");