CREATE TABLE "job_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"position_name" text NOT NULL,
	"job_level" text,
	"department_id" uuid,
	"team_id" uuid,
	"manager_person_id" uuid,
	"employment_type" text DEFAULT 'employee' NOT NULL,
	"work_location" text,
	"start_date" date NOT NULL,
	"probation_months" smallint DEFAULT 2 NOT NULL,
	"probation_salary_percent" smallint DEFAULT 85 NOT NULL,
	"base_salary_vnd" bigint NOT NULL,
	"allowances_vnd" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expires_on" date NOT NULL,
	"approval_request_id" uuid,
	"letter_template_id" uuid,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"decline_reason" text,
	"decline_note" text,
	"note" text,
	"created_by_person_id" uuid NOT NULL,
	"decided_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_offer_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "job_offer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_application_id_job_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_opening_id_job_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_opening"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_manager_person_id_person_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_letter_template_id_document_template_id_fk" FOREIGN KEY ("letter_template_id") REFERENCES "public"."document_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_offer_live_key" ON "job_offer" USING btree ("application_id") WHERE "job_offer"."status" in ('draft', 'pending_approval', 'approved', 'sent', 'accepted');--> statement-breakpoint
CREATE INDEX "job_offer_opening_idx" ON "job_offer" USING btree ("opening_id","status");--> statement-breakpoint
CREATE INDEX "job_offer_application_idx" ON "job_offer" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "job_offer_expiry_idx" ON "job_offer" USING btree ("status","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "job_application_hired_person_key" ON "job_application" USING btree ("hired_person_id") WHERE "job_application"."hired_person_id" is not null;