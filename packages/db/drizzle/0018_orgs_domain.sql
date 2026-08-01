ALTER TABLE "orgs" ADD COLUMN "domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_domain_uniq" ON "orgs" USING btree ("domain") WHERE "orgs"."domain" is not null;