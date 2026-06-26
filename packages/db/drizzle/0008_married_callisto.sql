CREATE TABLE "report_grants" (
	"report_id" uuid NOT NULL,
	"email" text NOT NULL,
	"granted_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "report_grants_report_id_email_pk" PRIMARY KEY("report_id","email")
);
--> statement-breakpoint
ALTER TABLE "report_grants" ADD CONSTRAINT "report_grants_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_grants_expires_at_idx" ON "report_grants" USING btree ("expires_at");