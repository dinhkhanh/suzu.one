CREATE TYPE "public"."contract_type" AS ENUM('probation', 'fixed_term', 'indefinite', 'service', 'internship', 'nda', 'appendix');--> statement-breakpoint
CREATE TYPE "public"."dependent_relationship" AS ENUM('child', 'spouse', 'parent', 'parent_in_law', 'sibling', 'grandparent', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('id_scan', 'degree', 'certificate', 'health_check', 'contract', 'decision', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_category" AS ENUM('manager', 'professional', 'intermediate', 'other');--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employment_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" "contract_type" NOT NULL,
	"parent_contract_id" uuid,
	"job_category" "job_category",
	"sign_date" date,
	"start_date" date NOT NULL,
	"end_date" date,
	"salary_terms" text,
	"note" text,
	"terminated_on" date,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contract_entity_number_key" UNIQUE("entity_id","number"),
	CONSTRAINT "contract_dates_check" CHECK ("contract"."end_date" IS NULL OR "contract"."end_date" >= "contract"."start_date")
);
--> statement-breakpoint
ALTER TABLE "contract" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dependent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"relationship" "dependent_relationship" NOT NULL,
	"date_of_birth" date,
	"id_number" text,
	"tax_code" text,
	"deduction_from" date NOT NULL,
	"deduction_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dependent_months_check" CHECK ("dependent"."deduction_to" IS NULL OR "dependent"."deduction_to" >= "dependent"."deduction_from")
);
--> statement-breakpoint
ALTER TABLE "dependent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "emergency_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"relationship" text,
	"phone" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emergency_contact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_alert_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"threshold_days" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_alert_sent_key" UNIQUE("kind","subject_id","due_on","threshold_days")
);
--> statement-breakpoint
ALTER TABLE "hr_alert_sent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"category" "document_category" NOT NULL,
	"title" text NOT NULL,
	"expires_on" date,
	"tier" text NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "person_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person_sensitive" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"national_id" text,
	"national_id_index" text,
	"national_id_issued_on" text,
	"national_id_issued_at" text,
	"passport_number" text,
	"tax_code" text,
	"social_insurance_number" text,
	"health_insurance_hospital" text,
	"bank_accounts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_sensitive" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_employment_id_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "public"."employment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_parent_contract_id_contract_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependent" ADD CONSTRAINT "dependent_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contact" ADD CONSTRAINT "emergency_contact_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_document" ADD CONSTRAINT "person_document_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_document" ADD CONSTRAINT "person_document_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_document" ADD CONSTRAINT "person_document_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_document" ADD CONSTRAINT "person_document_uploaded_by_person_id_person_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_sensitive" ADD CONSTRAINT "person_sensitive_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_person_idx" ON "contract" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "contract_end_date_idx" ON "contract" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "dependent_person_idx" ON "dependent" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "emergency_contact_person_idx" ON "emergency_contact" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_document_person_idx" ON "person_document" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_document_expires_idx" ON "person_document" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "person_sensitive_national_id_idx" ON "person_sensitive" USING btree ("national_id_index");