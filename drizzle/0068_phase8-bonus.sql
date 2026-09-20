CREATE TYPE "public"."bonus_run_status" AS ENUM('draft', 'simulated', 'proposed', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "one_on_one" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_person_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"meeting_on" date NOT NULL,
	"agenda" text,
	"shared_notes" text,
	"private_notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"shared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "one_on_one" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "one_on_one_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assignee_person_id" uuid,
	"due_on" date,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "one_on_one_action" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"year" integer NOT NULL,
	"result_id" uuid,
	"participant_id" uuid,
	"type" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"salary_request_id" uuid,
	"task_id" uuid,
	"raised_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_outcome" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bonus_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"entity_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payroll_month" text NOT NULL,
	"status" "bonus_run_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"totals_enc" text,
	"headcount" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"overridden_count" integer DEFAULT 0 NOT NULL,
	"simulated_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"proposed_at" timestamp with time zone,
	"proposed_by_person_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_person_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_by_person_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_run_month_check" CHECK ("bonus_run"."payroll_month" ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "bonus_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bonus_run_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"from_status" "bonus_run_status" NOT NULL,
	"to_status" "bonus_run_status" NOT NULL,
	"actor_person_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bonus_run_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bonus_run_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"scheme_version_id" uuid,
	"result_id" uuid,
	"kpi_score_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"exclusion_reason" text,
	"band_key" text,
	"multiplier_bp" integer,
	"service_months" integer,
	"final_score_bp" integer,
	"trace_enc" text NOT NULL,
	"override_reason" text,
	"override_by_person_id" uuid,
	"override_at" timestamp with time zone,
	"payroll_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bonus_run_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bonus_scheme" (
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
	CONSTRAINT "bonus_scheme_dates_check" CHECK ("bonus_scheme"."valid_to" IS NULL OR "bonus_scheme"."valid_to" >= "bonus_scheme"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "bonus_scheme" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_manager_person_id_person_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_one" ADD CONSTRAINT "one_on_one_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_one_action" ADD CONSTRAINT "one_on_one_action_meeting_id_one_on_one_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."one_on_one"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_one_action" ADD CONSTRAINT "one_on_one_action_assignee_person_id_person_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_outcome" ADD CONSTRAINT "review_outcome_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_outcome" ADD CONSTRAINT "review_outcome_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_outcome" ADD CONSTRAINT "review_outcome_result_id_performance_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."performance_result"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_outcome" ADD CONSTRAINT "review_outcome_participant_id_review_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."review_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_outcome" ADD CONSTRAINT "review_outcome_raised_by_person_id_person_id_fk" FOREIGN KEY ("raised_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_outcome" ADD CONSTRAINT "review_outcome_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run" ADD CONSTRAINT "bonus_run_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run" ADD CONSTRAINT "bonus_run_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run" ADD CONSTRAINT "bonus_run_approved_by_person_id_person_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run" ADD CONSTRAINT "bonus_run_paid_by_person_id_person_id_fk" FOREIGN KEY ("paid_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_event" ADD CONSTRAINT "bonus_run_event_run_id_bonus_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bonus_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_event" ADD CONSTRAINT "bonus_run_event_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_line" ADD CONSTRAINT "bonus_run_line_run_id_bonus_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bonus_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_line" ADD CONSTRAINT "bonus_run_line_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_line" ADD CONSTRAINT "bonus_run_line_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_line" ADD CONSTRAINT "bonus_run_line_scheme_version_id_bonus_scheme_id_fk" FOREIGN KEY ("scheme_version_id") REFERENCES "public"."bonus_scheme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_line" ADD CONSTRAINT "bonus_run_line_override_by_person_id_person_id_fk" FOREIGN KEY ("override_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_line" ADD CONSTRAINT "bonus_run_line_payroll_run_id_payroll_run_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_scheme" ADD CONSTRAINT "bonus_scheme_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_scheme" ADD CONSTRAINT "bonus_scheme_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_scheme" ADD CONSTRAINT "bonus_scheme_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "one_on_one_pair_idx" ON "one_on_one" USING btree ("person_id","meeting_on");--> statement-breakpoint
CREATE INDEX "one_on_one_manager_idx" ON "one_on_one" USING btree ("manager_person_id","meeting_on");--> statement-breakpoint
CREATE INDEX "one_on_one_action_meeting_idx" ON "one_on_one_action" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "review_outcome_person_idx" ON "review_outcome" USING btree ("person_id","year");--> statement-breakpoint
CREATE INDEX "review_outcome_status_idx" ON "review_outcome" USING btree ("status","year");--> statement-breakpoint
CREATE INDEX "bonus_run_year_idx" ON "bonus_run" USING btree ("year","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_run_year_key" ON "bonus_run" USING btree ("year") WHERE "bonus_run"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "bonus_run_event_run_idx" ON "bonus_run_event" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_run_line_key" ON "bonus_run_line" USING btree ("run_id","person_id");--> statement-breakpoint
CREATE INDEX "bonus_run_line_entity_idx" ON "bonus_run_line" USING btree ("run_id","entity_id");--> statement-breakpoint
CREATE INDEX "bonus_run_line_person_idx" ON "bonus_run_line" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "bonus_scheme_entity_idx" ON "bonus_scheme" USING btree ("entity_id","status","valid_from");--> statement-breakpoint

-- Approved bonus scheme versions of one scope never overlap (ADR-07), exactly like a pay policy:
-- the year the bonus is computed for reads one version and one version only.
ALTER TABLE "bonus_scheme" ADD CONSTRAINT "bonus_scheme_no_overlap"
  EXCLUDE USING gist ((COALESCE("entity_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("status" = 'approved');
--> statement-breakpoint

-- Every step a bonus run was carried through stays as it was recorded (NFR-SEC-05).
CREATE OR REPLACE FUNCTION bonus_run_event_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bonus_run_event is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bonus_run_event_append_only
  BEFORE UPDATE OR DELETE ON "bonus_run_event"
  FOR EACH ROW EXECUTE FUNCTION bonus_run_event_reject_change();
--> statement-breakpoint

-- A paid bonus run is evidence: the money is out and the KPI months behind it are frozen
-- (`kpi_score_use`). Nothing about it changes again, by any route.
CREATE OR REPLACE FUNCTION bonus_run_reject_paid_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'bonus_run % is paid and cannot be changed', OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bonus_run_paid_immutable
  BEFORE UPDATE OR DELETE ON "bonus_run"
  FOR EACH ROW EXECUTE FUNCTION bonus_run_reject_paid_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bonus_run_line_reject_paid_change() RETURNS trigger AS $$
DECLARE
  parent_status bonus_run_status;
BEGIN
  SELECT status INTO parent_status FROM bonus_run WHERE id = OLD.run_id;
  IF parent_status = 'paid' THEN
    RAISE EXCEPTION 'bonus run % is paid: line % cannot be changed', OLD.run_id, OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER bonus_run_line_paid_immutable
  BEFORE UPDATE OR DELETE ON "bonus_run_line"
  FOR EACH ROW EXECUTE FUNCTION bonus_run_line_reject_paid_change();
