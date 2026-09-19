CREATE TABLE "goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text NOT NULL,
	"entity_id" uuid,
	"department_id" uuid,
	"team_id" uuid,
	"person_id" uuid,
	"owner_person_id" uuid NOT NULL,
	"parent_goal_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"year" integer NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"final_progress_bp" integer,
	"closed_at" timestamp with time zone,
	"closed_by_person_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goal_check_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_result_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"value" bigint,
	"milestones" jsonb,
	"confidence" text NOT NULL,
	"note" text,
	"author_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_check_in" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "key_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"metric_type" text NOT NULL,
	"start_value" bigint DEFAULT 0 NOT NULL,
	"target_value" bigint DEFAULT 0 NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	"milestones" jsonb,
	"weight" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"confidence" text,
	"last_check_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "key_result" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_parent_goal_id_goal_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_closed_by_person_id_person_id_fk" FOREIGN KEY ("closed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_check_in" ADD CONSTRAINT "goal_check_in_key_result_id_key_result_id_fk" FOREIGN KEY ("key_result_id") REFERENCES "public"."key_result"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_check_in" ADD CONSTRAINT "goal_check_in_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_check_in" ADD CONSTRAINT "goal_check_in_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_result" ADD CONSTRAINT "key_result_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_parent_idx" ON "goal" USING btree ("parent_goal_id");--> statement-breakpoint
CREATE INDEX "goal_person_idx" ON "goal" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "goal_year_level_idx" ON "goal" USING btree ("year","level");--> statement-breakpoint
CREATE INDEX "goal_check_in_key_result_idx" ON "goal_check_in" USING btree ("key_result_id","created_at");--> statement-breakpoint
CREATE INDEX "goal_check_in_goal_idx" ON "goal_check_in" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE INDEX "key_result_goal_idx" ON "key_result" USING btree ("goal_id");--> statement-breakpoint
-- Check-ins are the record every goal figure is computed from (SRS D13): append-only, like the audit log.
CREATE OR REPLACE FUNCTION goal_check_in_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'goal_check_in is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER goal_check_in_append_only
  BEFORE UPDATE OR DELETE ON "goal_check_in"
  FOR EACH ROW EXECUTE FUNCTION goal_check_in_reject_change();
