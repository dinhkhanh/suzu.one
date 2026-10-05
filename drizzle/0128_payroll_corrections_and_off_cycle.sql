ALTER TYPE "public"."parameter_status" ADD VALUE 'voided';--> statement-breakpoint
ALTER TYPE "public"."pay_rule_status" ADD VALUE 'voided';--> statement-breakpoint
CREATE TABLE "payroll_parallel_signoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"people" integer NOT NULL,
	"matching" integer NOT NULL,
	"explained_lines" integer NOT NULL,
	"checked_with" text,
	"note" text,
	"signed_by_person_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_parallel_signoff_month_check" CHECK ("payroll_parallel_signoff"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "payroll_parallel_signoff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "bonus_run_year_key";--> statement-breakpoint
ALTER TABLE "statutory_parameter" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statutory_parameter" ADD COLUMN "voided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "statutory_parameter" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "bonus_scheme" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bonus_scheme" ADD COLUMN "voided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bonus_scheme" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "pay_component" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_component" ADD COLUMN "voided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_component" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD COLUMN "voided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD COLUMN "voided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD COLUMN "voided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "payroll_parallel_signoff" ADD CONSTRAINT "payroll_parallel_signoff_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_parallel_signoff" ADD CONSTRAINT "payroll_parallel_signoff_signed_by_person_id_person_id_fk" FOREIGN KEY ("signed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_parallel_signoff_month_idx" ON "payroll_parallel_signoff" USING btree ("entity_id","month","signed_at");--> statement-breakpoint
ALTER TABLE "statutory_parameter" ADD CONSTRAINT "statutory_parameter_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_scheme" ADD CONSTRAINT "bonus_scheme_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_component" ADD CONSTRAINT "pay_component_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD CONSTRAINT "pay_profile_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD CONSTRAINT "payroll_policy_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_run_year_name_key" ON "bonus_run" USING btree ("year","name") WHERE "bonus_run"."status" <> 'cancelled';--> statement-breakpoint
-- A voided salary structure no longer holds its dates (PAY-13): the version it replaced may take
-- them back, and a corrected one may be approved over them. Only structures in force are constrained.
ALTER TABLE "salary_structure" DROP CONSTRAINT "salary_structure_no_overlap";--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_no_overlap"
  EXCLUDE USING gist ("employment_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("voided_at" IS NULL);
