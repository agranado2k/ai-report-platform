CREATE TABLE "report_org_write_grants" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_org_write_grants" ADD CONSTRAINT "report_org_write_grants_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_org_write_grants" ADD CONSTRAINT "report_org_write_grants_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_org_write_grants" ADD CONSTRAINT "report_org_write_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;