CREATE TYPE "public"."payroll_run_kind" AS ENUM('regular', 'off_cycle');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'calculated', 'proposed', 'approved', 'payment_prepared', 'paid', 'locked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."retro_item_kind" AS ENUM('salary_change', 'timesheet_adjustment', 'manual');--> statement-breakpoint
CREATE TYPE "public"."retro_item_status" AS ENUM('open', 'taken', 'cancelled');--> statement-breakpoint
CREATE TABLE "payroll_retro_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source_month" text NOT NULL,
	"kind" "retro_item_kind" NOT NULL,
	"status" "retro_item_status" DEFAULT 'open' NOT NULL,
	"amount_enc" text NOT NULL,
	"reason" text NOT NULL,
	"insurance_base_changed" boolean DEFAULT false NOT NULL,
	"source_ref" uuid,
	"payroll_month" text,
	"run_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_retro_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"kind" "payroll_run_kind" DEFAULT 'regular' NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"name" text,
	"note" text,
	"context" jsonb,
	"totals_enc" text,
	"headcount" integer DEFAULT 0 NOT NULL,
	"calculated_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_run_month_check" CHECK ("payroll_run"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "payroll_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_run_input" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"code" text NOT NULL,
	"amount_enc" text NOT NULL,
	"note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_run_input" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_run_person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"profile" "pay_profile_kind" NOT NULL,
	"result_enc" text NOT NULL,
	"input_enc" text NOT NULL,
	"warnings" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_run_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_retro_item" ADD CONSTRAINT "payroll_retro_item_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_retro_item" ADD CONSTRAINT "payroll_retro_item_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_retro_item" ADD CONSTRAINT "payroll_retro_item_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_retro_item" ADD CONSTRAINT "payroll_retro_item_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_input" ADD CONSTRAINT "payroll_run_input_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_input" ADD CONSTRAINT "payroll_run_input_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_input" ADD CONSTRAINT "payroll_run_input_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_person" ADD CONSTRAINT "payroll_run_person_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_person" ADD CONSTRAINT "payroll_run_person_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_person" ADD CONSTRAINT "payroll_run_person_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_retro_item_entity_idx" ON "payroll_retro_item" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "payroll_retro_item_person_idx" ON "payroll_retro_item" USING btree ("person_id","source_month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_retro_item_source_key" ON "payroll_retro_item" USING btree ("person_id","kind","source_ref") WHERE "payroll_retro_item"."source_ref" IS NOT NULL AND "payroll_retro_item"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "payroll_run_entity_month_idx" ON "payroll_run" USING btree ("entity_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_regular_key" ON "payroll_run" USING btree ("entity_id","month") WHERE "payroll_run"."kind" = 'regular' AND "payroll_run"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_input_key" ON "payroll_run_input" USING btree ("run_id","person_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_person_key" ON "payroll_run_person" USING btree ("run_id","person_id");--> statement-breakpoint
CREATE INDEX "payroll_run_person_person_idx" ON "payroll_run_person" USING btree ("person_id");