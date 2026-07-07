CREATE TABLE "report_write_grants" (
	"report_id" uuid NOT NULL,
	"grantee_email" text NOT NULL,
	"grantee_user_id" uuid,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_write_grants_report_id_grantee_email_pk" PRIMARY KEY("report_id","grantee_email")
);
--> statement-breakpoint
ALTER TABLE "report_write_grants" ADD CONSTRAINT "report_write_grants_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_write_grants" ADD CONSTRAINT "report_write_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_write_grants" ADD CONSTRAINT "report_write_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_write_grants_grantee_email_idx" ON "report_write_grants" USING btree ("grantee_email");