CREATE TYPE "public"."leave_accrual_method" AS ENUM('none', 'monthly_accrual', 'yearly_grant');--> statement-breakpoint
CREATE TYPE "public"."leave_base_source" AS ENUM('statutory_annual', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."leave_category" AS ENUM('annual', 'sick', 'maternity', 'paternity', 'personal_paid', 'unpaid', 'compensatory', 'company');--> statement-breakpoint
CREATE TYPE "public"."leave_gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."leave_ledger_kind" AS ENUM('opening', 'accrual', 'grant', 'use', 'refund', 'adjustment', 'expiry', 'carry_over', 'payout');--> statement-breakpoint
CREATE TYPE "public"."leave_payroll_treatment" AS ENUM('paid_company', 'paid_insurance', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."leave_portion" AS ENUM('full', 'am', 'pm', 'hours');--> statement-breakpoint
CREATE TYPE "public"."leave_probation_rule" AS ENUM('accrue_and_use', 'accrue_no_use', 'no_accrual');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_rounding" AS ENUM('none', 'half_day', 'full_day');--> statement-breakpoint
CREATE TABLE "leave_ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"leave_type_id" uuid NOT NULL,
	"leave_year" smallint NOT NULL,
	"kind" "leave_ledger_kind" NOT NULL,
	"amount_centi" integer NOT NULL,
	"effective_date" date NOT NULL,
	"source_key" text,
	"request_id" uuid,
	"reason" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_ledger_entry_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
ALTER TABLE "leave_ledger_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"entity_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"accrual_method" "leave_accrual_method" NOT NULL,
	"base_source" "leave_base_source" DEFAULT 'fixed' NOT NULL,
	"fixed_days_centi" integer DEFAULT 0 NOT NULL,
	"extra_days_centi" integer DEFAULT 0 NOT NULL,
	"seniority_bonus" boolean DEFAULT false NOT NULL,
	"prorate" boolean DEFAULT true NOT NULL,
	"rounding" "leave_rounding" DEFAULT 'half_day' NOT NULL,
	"probation_rule" "leave_probation_rule" DEFAULT 'accrue_no_use' NOT NULL,
	"carry_over_cap_centi" integer,
	"carry_over_expiry" text,
	"payout_on_termination" boolean DEFAULT false NOT NULL,
	"allow_negative_centi" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_portion" "leave_portion" DEFAULT 'full' NOT NULL,
	"end_portion" "leave_portion" DEFAULT 'full' NOT NULL,
	"minutes" smallint,
	"total_centi" integer NOT NULL,
	"reason" text,
	"attachment_file_id" uuid,
	"status" "leave_request_status" DEFAULT 'pending' NOT NULL,
	"approval_request_id" uuid,
	"amends_request_id" uuid,
	"filed_by_person_id" uuid,
	"cancelled_by_person_id" uuid,
	"cancel_reason" text,
	"lifecycle_event_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_request_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"portion" "leave_portion" NOT NULL,
	"amount_centi" integer NOT NULL,
	"minutes" smallint,
	CONSTRAINT "leave_request_day_request_date_key" UNIQUE("request_id","date")
);
--> statement-breakpoint
ALTER TABLE "leave_request_day" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"category" "leave_category" NOT NULL,
	"is_paid" boolean NOT NULL,
	"payroll_treatment" "leave_payroll_treatment" NOT NULL,
	"tracks_balance" boolean DEFAULT false NOT NULL,
	"allow_half_day" boolean DEFAULT true NOT NULL,
	"allow_hourly" boolean DEFAULT false NOT NULL,
	"requires_attachment" boolean DEFAULT false NOT NULL,
	"notice_days" smallint DEFAULT 0 NOT NULL,
	"allow_backdated" boolean DEFAULT false NOT NULL,
	"max_days_per_request_centi" integer,
	"eligible_workforce_types" text[],
	"gender" "leave_gender",
	"min_seniority_months" smallint,
	"is_long_term" boolean DEFAULT false NOT NULL,
	"counts_untracked_days" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_type_entity_code_key" UNIQUE NULLS NOT DISTINCT("entity_id","code")
);
--> statement-breakpoint
ALTER TABLE "leave_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_staffing_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"department_id" uuid,
	"team_id" uuid,
	"min_present" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_staffing_rule_scope_key" UNIQUE NULLS NOT DISTINCT("entity_id","department_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "team_staffing_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_attachment_file_id_stored_file_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_filed_by_person_id_person_id_fk" FOREIGN KEY ("filed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_cancelled_by_person_id_person_id_fk" FOREIGN KEY ("cancelled_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_day" ADD CONSTRAINT "leave_request_day_request_id_leave_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_day" ADD CONSTRAINT "leave_request_day_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staffing_rule" ADD CONSTRAINT "team_staffing_rule_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staffing_rule" ADD CONSTRAINT "team_staffing_rule_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staffing_rule" ADD CONSTRAINT "team_staffing_rule_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_ledger_person_idx" ON "leave_ledger_entry" USING btree ("person_id","leave_type_id","leave_year");--> statement-breakpoint
CREATE INDEX "leave_ledger_entity_date_idx" ON "leave_ledger_entry" USING btree ("entity_id","effective_date");--> statement-breakpoint
CREATE INDEX "leave_policy_type_idx" ON "leave_policy" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "leave_request_person_idx" ON "leave_request" USING btree ("person_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_request_approval_idx" ON "leave_request" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "leave_request_day_person_date_idx" ON "leave_request_day" USING btree ("person_id","date");