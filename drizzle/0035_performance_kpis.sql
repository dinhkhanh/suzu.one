CREATE TABLE "kpi_actual" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kpi_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"actual_value" bigint,
	"not_applicable" boolean DEFAULT false NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"entered_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_actual_unique" UNIQUE("assignment_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "kpi_actual" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kpi_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kpi_id" uuid NOT NULL,
	"weight" integer NOT NULL,
	"target_value" bigint NOT NULL,
	"from_period" text NOT NULL,
	"to_period" text,
	"source_position_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kpi_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit" text NOT NULL,
	"direction" text DEFAULT 'higher_better' NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"cap_bp" integer DEFAULT 12000 NOT NULL,
	"floor_bp" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_definition_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "kpi_definition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kpi_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by_person_id" uuid,
	"closed_at" timestamp with time zone,
	"override_reason" text,
	"exceptions" jsonb,
	"reopened_by_person_id" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_period_unique" UNIQUE("entity_id","month")
);
--> statement-breakpoint
ALTER TABLE "kpi_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kpi_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"revision" integer NOT NULL,
	"score_bp" integer,
	"trace" jsonb NOT NULL,
	"inputs_hash" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "kpi_score_unique" UNIQUE("person_id","month","revision")
);
--> statement-breakpoint
ALTER TABLE "kpi_score" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "position_kpi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"entity_id" uuid,
	"kpi_id" uuid NOT NULL,
	"weight" integer NOT NULL,
	"target_value" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_kpi_unique" UNIQUE NULLS NOT DISTINCT("position_id","entity_id","kpi_id")
);
--> statement-breakpoint
ALTER TABLE "position_kpi" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kpi_actual" ADD CONSTRAINT "kpi_actual_assignment_id_kpi_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."kpi_assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_actual" ADD CONSTRAINT "kpi_actual_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_actual" ADD CONSTRAINT "kpi_actual_kpi_id_kpi_definition_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_actual" ADD CONSTRAINT "kpi_actual_entered_by_person_id_person_id_fk" FOREIGN KEY ("entered_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_kpi_id_kpi_definition_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_source_position_id_position_id_fk" FOREIGN KEY ("source_position_id") REFERENCES "public"."position"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_period" ADD CONSTRAINT "kpi_period_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_period" ADD CONSTRAINT "kpi_period_closed_by_person_id_person_id_fk" FOREIGN KEY ("closed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_period" ADD CONSTRAINT "kpi_period_reopened_by_person_id_person_id_fk" FOREIGN KEY ("reopened_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_score" ADD CONSTRAINT "kpi_score_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_score" ADD CONSTRAINT "kpi_score_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_kpi" ADD CONSTRAINT "position_kpi_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_kpi" ADD CONSTRAINT "position_kpi_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_kpi" ADD CONSTRAINT "position_kpi_kpi_id_kpi_definition_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpi_definition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpi_actual_person_idx" ON "kpi_actual" USING btree ("person_id","period_key");--> statement-breakpoint
CREATE INDEX "kpi_assignment_person_idx" ON "kpi_assignment" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "kpi_assignment_entity_idx" ON "kpi_assignment" USING btree ("entity_id","from_period");--> statement-breakpoint
CREATE INDEX "kpi_score_entity_month_idx" ON "kpi_score" USING btree ("entity_id","month");--> statement-breakpoint
CREATE INDEX "position_kpi_position_idx" ON "position_kpi" USING btree ("position_id");--> statement-breakpoint
-- A stored KPI score is what a bonus was (or will be) computed from (SRS D13): it is never deleted
-- and never rewritten. The one change allowed is marking it superseded when HR reopens the month;
-- the next close writes a new revision beside it.
CREATE OR REPLACE FUNCTION kpi_score_reject_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kpi_score rows are never deleted';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.person_id IS DISTINCT FROM OLD.person_id
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.month IS DISTINCT FROM OLD.month
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.score_bp IS DISTINCT FROM OLD.score_bp
     OR NEW.trace IS DISTINCT FROM OLD.trace
     OR NEW.inputs_hash IS DISTINCT FROM OLD.inputs_hash
     OR NEW.computed_at IS DISTINCT FROM OLD.computed_at THEN
    RAISE EXCEPTION 'kpi_score is immutable: a row can only be marked superseded, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kpi_score_immutable
  BEFORE UPDATE OR DELETE ON "kpi_score"
  FOR EACH ROW EXECUTE FUNCTION kpi_score_reject_change();
