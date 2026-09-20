CREATE TYPE "public"."payroll_calc_state" AS ENUM('idle', 'queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "payroll_run_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"from_status" "payroll_run_status" NOT NULL,
	"to_status" "payroll_run_status" NOT NULL,
	"actor_person_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_run_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "proposed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "approved_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "payment_prepared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "payment_prepared_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "paid_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "locked_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "calc_state" "payroll_calc_state" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "calc_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "calc_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "calc_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "calc_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "calc_claim" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD COLUMN "calc_error" text;--> statement-breakpoint
ALTER TABLE "payroll_run_event" ADD CONSTRAINT "payroll_run_event_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_event" ADD CONSTRAINT "payroll_run_event_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_run_event_run_idx" ON "payroll_run_event" USING btree ("run_id","created_at");--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_approved_by_person_id_person_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_payment_prepared_by_person_id_person_id_fk" FOREIGN KEY ("payment_prepared_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_paid_by_person_id_person_id_fk" FOREIGN KEY ("paid_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_locked_by_person_id_person_id_fk" FOREIGN KEY ("locked_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A locked payroll run is evidence (FR-PAY-30, DR-07): nothing about it changes again, by any
-- route, including a mistaken service call or a hand-written UPDATE. A correction to a locked
-- month is a retro item in the next run (FR-PAY-17), never an edit to this one.
CREATE OR REPLACE FUNCTION payroll_run_reject_locked_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'payroll_run % is locked and cannot be changed', OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payroll_run_locked_immutable
  BEFORE UPDATE OR DELETE ON "payroll_run"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_reject_locked_change();--> statement-breakpoint

-- The same for everything hanging off it: a locked run's people and its typed-in figures.
CREATE OR REPLACE FUNCTION payroll_run_child_reject_locked_change() RETURNS trigger AS $$
DECLARE
  parent_status payroll_run_status;
BEGIN
  SELECT status INTO parent_status FROM payroll_run WHERE id = OLD.run_id;
  IF parent_status = 'locked' THEN
    RAISE EXCEPTION 'payroll run % is locked: %.% cannot be changed', OLD.run_id, TG_TABLE_NAME, OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payroll_run_person_locked_immutable
  BEFORE UPDATE OR DELETE ON "payroll_run_person"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_child_reject_locked_change();--> statement-breakpoint
CREATE TRIGGER payroll_run_input_locked_immutable
  BEFORE UPDATE OR DELETE ON "payroll_run_input"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_child_reject_locked_change();--> statement-breakpoint

-- Every step a run was carried through stays as it was recorded, like the audit log (NFR-SEC-05).
CREATE OR REPLACE FUNCTION payroll_run_event_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payroll_run_event is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payroll_run_event_append_only
  BEFORE UPDATE OR DELETE ON "payroll_run_event"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_event_reject_change();
