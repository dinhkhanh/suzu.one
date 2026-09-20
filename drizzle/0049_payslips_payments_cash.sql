CREATE TYPE "public"."payment_channel" AS ENUM('bank', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payslip_query_status" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TABLE "payroll_cash_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"amount_enc" text NOT NULL,
	"disbursed_on" date,
	"disbursed_by_person_id" uuid,
	"disbursement_note" text,
	"receipt_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_cash_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_payment_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"bank" text,
	"format_version" text NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"total_enc" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by_person_id" uuid
);
--> statement-breakpoint
ALTER TABLE "payroll_payment_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payslip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by_person_id" uuid,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payslip" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payslip_query" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payslip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "payslip_query_status" DEFAULT 'open' NOT NULL,
	"answered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payslip_query" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payslip_query_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payslip_query_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "payslips_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "payslips_published_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_cash_payment" ADD CONSTRAINT "payroll_cash_payment_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_cash_payment" ADD CONSTRAINT "payroll_cash_payment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_cash_payment" ADD CONSTRAINT "payroll_cash_payment_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_cash_payment" ADD CONSTRAINT "payroll_cash_payment_disbursed_by_person_id_person_id_fk" FOREIGN KEY ("disbursed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_file" ADD CONSTRAINT "payroll_payment_file_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_file" ADD CONSTRAINT "payroll_payment_file_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_file" ADD CONSTRAINT "payroll_payment_file_generated_by_person_id_person_id_fk" FOREIGN KEY ("generated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_published_by_person_id_person_id_fk" FOREIGN KEY ("published_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_query" ADD CONSTRAINT "payslip_query_payslip_id_payslip_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_query" ADD CONSTRAINT "payslip_query_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_query" ADD CONSTRAINT "payslip_query_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_query_message" ADD CONSTRAINT "payslip_query_message_query_id_payslip_query_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."payslip_query"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_query_message" ADD CONSTRAINT "payslip_query_message_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_cash_payment_key" ON "payroll_cash_payment" USING btree ("run_id","person_id");--> statement-breakpoint
CREATE INDEX "payroll_cash_payment_person_idx" ON "payroll_cash_payment" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "payroll_payment_file_run_idx" ON "payroll_payment_file" USING btree ("run_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_run_person_key" ON "payslip" USING btree ("run_id","person_id");--> statement-breakpoint
CREATE INDEX "payslip_person_idx" ON "payslip" USING btree ("person_id","month");--> statement-breakpoint
CREATE INDEX "payslip_entity_month_idx" ON "payslip" USING btree ("entity_id","month");--> statement-breakpoint
CREATE INDEX "payslip_query_payslip_idx" ON "payslip_query" USING btree ("payslip_id");--> statement-breakpoint
CREATE INDEX "payslip_query_entity_idx" ON "payslip_query" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "payslip_query_message_query_idx" ON "payslip_query_message" USING btree ("query_id","created_at");--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_payslips_published_by_person_id_person_id_fk" FOREIGN KEY ("payslips_published_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- What was said about someone's pay is evidence: neither side rewrites the thread (NFR-SEC-05),
-- the same rule the run's own history already follows.
CREATE OR REPLACE FUNCTION payslip_query_message_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payslip_query_message is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payslip_query_message_append_only
  BEFORE UPDATE OR DELETE ON "payslip_query_message"
  FOR EACH ROW EXECUTE FUNCTION payslip_query_message_reject_change();--> statement-breakpoint

-- A locked run's payment files and cash disbursements are as immutable as the run itself (DR-07):
-- a correction is a retro item in the next month, never an edit here.
-- `payroll_run_child_reject_locked_change` is the function migration 0048 installed.
--
-- `payslip` deliberately carries no such trigger: a payslip is read most often *after* its month
-- is locked, and reading it moves the view counters. What the row says about the release itself is
-- written once, by an insert that does nothing on conflict.
CREATE TRIGGER payroll_payment_file_locked_immutable
  BEFORE UPDATE OR DELETE ON "payroll_payment_file"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_child_reject_locked_change();--> statement-breakpoint
CREATE TRIGGER payroll_cash_payment_locked_immutable
  BEFORE UPDATE OR DELETE ON "payroll_cash_payment"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_child_reject_locked_change();
