-- A locked run is immutable (DR-07) — but the employee's own confirmation that they took their
-- cash is evidence *about* a payment that has already happened, and it routinely arrives after
-- the month is closed: somebody is on leave, or simply opens the app a week later. Refusing it
-- would mean a locked month can never be fully evidenced, which is the opposite of the intent.
--
-- So `payroll_cash_payment` gets its own rule: after the lock, the only thing that may change is
-- `receipt_confirmed_at`, and only from null to a value. The amount, the date the money was
-- handed over, who handed it over and their note stay frozen like everything else, and a
-- confirmation once given is never rewritten.
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
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'payroll run % is locked: payroll_cash_payment.% cannot be changed', OLD.run_id, OLD.id;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS payroll_cash_payment_locked_immutable ON "payroll_cash_payment";--> statement-breakpoint
CREATE TRIGGER payroll_cash_payment_locked_immutable
  BEFORE UPDATE OR DELETE ON "payroll_cash_payment"
  FOR EACH ROW EXECUTE FUNCTION payroll_cash_payment_reject_locked_change();
