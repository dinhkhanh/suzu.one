CREATE TYPE "public"."insurance_exemption" AS ENUM('probation', 'retiree', 'insured_elsewhere', 'foreigner', 'other');--> statement-breakpoint
CREATE TYPE "public"."pay_component_category" AS ENUM('salary', 'allowance', 'overtime', 'bonus', 'commission', 'thirteenth_month', 'holiday_bonus', 'leave_payout', 'retro', 'insurance', 'pit', 'union', 'advance', 'penalty', 'asset_compensation', 'loan', 'other');--> statement-breakpoint
CREATE TYPE "public"."pay_component_kind" AS ENUM('earning', 'deduction', 'employer_cost');--> statement-breakpoint
CREATE TYPE "public"."pay_component_source" AS ENUM('structure', 'formula', 'engine', 'input');--> statement-breakpoint
CREATE TYPE "public"."pay_profile_kind" AS ENUM('statutory', 'simple');--> statement-breakpoint
CREATE TYPE "public"."pay_proration" AS ENUM('fixed', 'attendance');--> statement-breakpoint
CREATE TYPE "public"."pay_rule_status" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."pay_tax_treatment" AS ENUM('taxable', 'exempt', 'exempt_up_to_cap');--> statement-breakpoint
CREATE TYPE "public"."pit_method" AS ENUM('progressive', 'flat_without_contract', 'flat_non_resident');--> statement-breakpoint
CREATE TYPE "public"."salary_change_reason" AS ENUM('initial', 'probation_end', 'raise', 'promotion', 'adjustment', 'contract_renewal');--> statement-breakpoint
CREATE TYPE "public"."simple_profile_basis" AS ENUM('probation', 'internship', 'service_contract', 'short_term', 'retiree', 'other');--> statement-breakpoint
CREATE TYPE "public"."tax_residency" AS ENUM('resident', 'non_resident');--> statement-breakpoint
ALTER TYPE "public"."lifecycle_event_type" ADD VALUE 'pay_profile_change' BEFORE 'discipline';--> statement-breakpoint
CREATE TABLE "pay_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"kind" "pay_component_kind" NOT NULL,
	"category" "pay_component_category" NOT NULL,
	"source" "pay_component_source" NOT NULL,
	"tax_treatment" "pay_tax_treatment" DEFAULT 'taxable' NOT NULL,
	"exempt_cap" integer,
	"subject_to_insurance" boolean DEFAULT false NOT NULL,
	"proration" "pay_proration" DEFAULT 'fixed' NOT NULL,
	"rounding_rule" text DEFAULT 'half_up' NOT NULL,
	"formula" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" "pay_rule_status" DEFAULT 'proposed' NOT NULL,
	"note" text,
	"proposed_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_component_dates_check" CHECK ("pay_component"."valid_to" IS NULL OR "pay_component"."valid_to" >= "pay_component"."valid_from"),
	CONSTRAINT "pay_component_code_check" CHECK ("pay_component"."code" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
	CONSTRAINT "pay_component_cap_check" CHECK (("pay_component"."tax_treatment" = 'exempt_up_to_cap') = ("pay_component"."exempt_cap" IS NOT NULL)),
	CONSTRAINT "pay_component_formula_check" CHECK (("pay_component"."source" = 'formula') = ("pay_component"."formula" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "pay_component" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile" "pay_profile_kind" NOT NULL,
	"simple_basis" "simple_profile_basis",
	"review_date" date,
	"tax_residency" "tax_residency" DEFAULT 'resident' NOT NULL,
	"pit_method" "pit_method" DEFAULT 'progressive' NOT NULL,
	"pit_commitment" boolean DEFAULT false NOT NULL,
	"insurance_exemption" "insurance_exemption",
	"union_member" boolean DEFAULT false NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" "pay_rule_status" DEFAULT 'proposed' NOT NULL,
	"note" text,
	"proposed_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_profile_dates_check" CHECK ("pay_profile"."valid_to" IS NULL OR "pay_profile"."valid_to" >= "pay_profile"."valid_from"),
	CONSTRAINT "pay_profile_basis_check" CHECK (("pay_profile"."profile" = 'simple') = ("pay_profile"."simple_basis" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "pay_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"value" jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" "pay_rule_status" DEFAULT 'proposed' NOT NULL,
	"note" text,
	"proposed_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_policy_dates_check" CHECK ("payroll_policy"."valid_to" IS NULL OR "payroll_policy"."valid_to" >= "payroll_policy"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "payroll_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salary_structure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"terms_enc" text NOT NULL,
	"reason" "salary_change_reason" NOT NULL,
	"approval_request_id" uuid,
	"decision_number" text,
	"decided_by_person_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_structure_dates_check" CHECK ("salary_structure"."valid_to" IS NULL OR "salary_structure"."valid_to" >= "salary_structure"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "salary_structure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_component" ADD CONSTRAINT "pay_component_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_component" ADD CONSTRAINT "pay_component_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_component" ADD CONSTRAINT "pay_component_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD CONSTRAINT "pay_profile_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD CONSTRAINT "pay_profile_employment_id_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "public"."employment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD CONSTRAINT "pay_profile_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD CONSTRAINT "pay_profile_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_profile" ADD CONSTRAINT "pay_profile_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD CONSTRAINT "payroll_policy_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD CONSTRAINT "payroll_policy_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD CONSTRAINT "payroll_policy_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_employment_id_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "public"."employment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_component_code_idx" ON "pay_component" USING btree ("code","valid_from");--> statement-breakpoint
CREATE INDEX "pay_profile_person_idx" ON "pay_profile" USING btree ("person_id","valid_from");--> statement-breakpoint
CREATE INDEX "pay_profile_entity_idx" ON "pay_profile" USING btree ("entity_id","profile");--> statement-breakpoint
CREATE INDEX "payroll_policy_entity_idx" ON "payroll_policy" USING btree ("entity_id","valid_from");--> statement-breakpoint
CREATE INDEX "salary_structure_person_idx" ON "salary_structure" USING btree ("person_id","valid_from");--> statement-breakpoint
CREATE INDEX "salary_structure_entity_idx" ON "salary_structure" USING btree ("entity_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_structure_decision_number_key" ON "salary_structure" USING btree ("entity_id","decision_number");