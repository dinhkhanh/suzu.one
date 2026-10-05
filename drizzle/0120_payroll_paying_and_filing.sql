CREATE TABLE "entity_bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"bank" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"branch" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_bank_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bonus_run_handoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bonus_run_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"headcount" integer NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bonus_run_handoff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_other_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_other_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_cash_payment" ADD COLUMN "disbursed_amount_enc" text;--> statement-breakpoint
ALTER TABLE "payroll_payment_file" ADD COLUMN "covered_person_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payment_file" ADD COLUMN "paying_account_id" uuid;--> statement-breakpoint
ALTER TABLE "entity_bank_account" ADD CONSTRAINT "entity_bank_account_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_handoff" ADD CONSTRAINT "bonus_run_handoff_bonus_run_id_bonus_run_id_fk" FOREIGN KEY ("bonus_run_id") REFERENCES "public"."bonus_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_handoff" ADD CONSTRAINT "bonus_run_handoff_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_handoff" ADD CONSTRAINT "bonus_run_handoff_payroll_run_id_payroll_run_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_handoff" ADD CONSTRAINT "bonus_run_handoff_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_other_payment" ADD CONSTRAINT "payroll_other_payment_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_other_payment" ADD CONSTRAINT "payroll_other_payment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_other_payment" ADD CONSTRAINT "payroll_other_payment_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_other_payment" ADD CONSTRAINT "payroll_other_payment_recorded_by_person_id_person_id_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_bank_account_key" ON "entity_bank_account" USING btree ("entity_id","bank","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_bank_account_default_key" ON "entity_bank_account" USING btree ("entity_id","bank") WHERE "entity_bank_account"."is_default" AND "entity_bank_account"."is_active";--> statement-breakpoint
CREATE INDEX "bonus_run_handoff_run_idx" ON "bonus_run_handoff" USING btree ("bonus_run_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_run_handoff_payroll_run_key" ON "bonus_run_handoff" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_other_payment_key" ON "payroll_other_payment" USING btree ("run_id","person_id");--> statement-breakpoint
CREATE INDEX "payroll_other_payment_person_idx" ON "payroll_other_payment" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "payroll_payment_file" ADD CONSTRAINT "payroll_payment_file_paying_account_id_entity_bank_account_id_fk" FOREIGN KEY ("paying_account_id") REFERENCES "public"."entity_bank_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- "Paid another way" is part of how a run was paid: once the run is locked it is as immutable as
-- the payment files and the cash rows beside it (DR-07). The function is migration 0048's.
CREATE TRIGGER payroll_other_payment_locked_immutable
  BEFORE UPDATE OR DELETE ON "payroll_other_payment"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_child_reject_locked_change();--> statement-breakpoint

-- The cash row's own rule (migration 0050) learns the new column: after the lock the only thing
-- that may still change is the employee's confirmation, so the amount actually handed over is
-- frozen with the date, the payer and the note. Otherwise unchanged, search_path included (0094).
CREATE OR REPLACE FUNCTION payroll_cash_payment_reject_locked_change() RETURNS trigger AS $$
DECLARE
  locked boolean;
BEGIN
  SELECT status = 'locked' INTO locked FROM payroll_run WHERE id = COALESCE(OLD.run_id, NEW.run_id);
  IF NOT COALESCE(locked, false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payroll run % is locked: payroll_cash_payment.% cannot be deleted', OLD.run_id, OLD.id;
  END IF;

  IF OLD.receipt_confirmed_at IS NULL
     AND NEW.receipt_confirmed_at IS NOT NULL
     AND NEW.id = OLD.id
     AND NEW.run_id = OLD.run_id
     AND NEW.person_id = OLD.person_id
     AND NEW.entity_id = OLD.entity_id
     AND NEW.amount_enc = OLD.amount_enc
     AND NEW.disbursed_on IS NOT DISTINCT FROM OLD.disbursed_on
     AND NEW.disbursed_by_person_id IS NOT DISTINCT FROM OLD.disbursed_by_person_id
     AND NEW.disbursement_note IS NOT DISTINCT FROM OLD.disbursement_note
     AND NEW.disbursed_amount_enc IS NOT DISTINCT FROM OLD.disbursed_amount_enc
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'payroll run % is locked: payroll_cash_payment.% cannot be changed', OLD.run_id, OLD.id;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;--> statement-breakpoint

-- A paid bonus run's lines stay frozen (migration 0068), with one exception: which payroll run a
-- line was handed to. When an entity's off-cycle run is cancelled in payroll and the entity is
-- handed over again, the line must point at the new run — and nothing else about it may move.
CREATE OR REPLACE FUNCTION bonus_run_line_reject_paid_change() RETURNS trigger AS $$
DECLARE
  parent_status bonus_run_status;
BEGIN
  SELECT status INTO parent_status FROM bonus_run WHERE id = OLD.run_id;
  IF parent_status = 'paid' THEN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'payroll_run_id' - 'updated_at') = (to_jsonb(OLD) - 'payroll_run_id' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'bonus run % is paid: line % cannot be changed', OLD.run_id, OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;