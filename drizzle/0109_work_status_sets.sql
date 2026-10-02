-- Status sets kept by people, not shipped in code (FR-WRK-03, FR-PJM): a library of task workflows
-- a new team starts from, and of project statuses a team's projects move through.
--
-- `work_project.status` stays the category every rule reads (planned / active / paused / done /
-- archived), so the code deployed before this migration keeps working untouched. `status_id` names
-- the status itself; a trigger keeps the two together whichever one a writer sets.

CREATE TABLE "work_project_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_project_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_project_status_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_team_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_project_status_set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_state_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_team_id" uuid,
	"states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_state_set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_project" ADD COLUMN "status_id" uuid;--> statement-breakpoint
ALTER TABLE "work_team" ADD COLUMN "project_status_set_id" uuid;--> statement-breakpoint
ALTER TABLE "work_project_status" ADD CONSTRAINT "work_project_status_set_id_work_project_status_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."work_project_status_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project_status_set" ADD CONSTRAINT "work_project_status_set_owner_team_id_work_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project_status_set" ADD CONSTRAINT "work_project_status_set_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_state_set" ADD CONSTRAINT "work_state_set_owner_team_id_work_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_state_set" ADD CONSTRAINT "work_state_set_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_project_status_set_idx" ON "work_project_status" USING btree ("set_id","sort_order");--> statement-breakpoint
CREATE INDEX "work_project_status_set_owner_idx" ON "work_project_status_set" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "work_state_set_owner_idx" ON "work_state_set" USING btree ("owner_team_id");--> statement-breakpoint
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_status_id_work_project_status_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."work_project_status"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_team" ADD CONSTRAINT "work_team_project_status_set_id_work_project_status_set_id_fk" FOREIGN KEY ("project_status_set_id") REFERENCES "public"."work_project_status_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_project_status_idx" ON "work_project" USING btree ("status_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.work_project_status_sync() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."status_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."status_id" IS DISTINCT FROM OLD."status_id") THEN
    -- A status was named: its category is the project's.
    SELECT s."category" INTO NEW."status" FROM "work_project_status" s WHERE s."id" = NEW."status_id";
  ELSIF TG_OP = 'INSERT' OR NEW."status_id" IS NULL OR NEW."status" IS DISTINCT FROM OLD."status" OR NEW."team_id" IS DISTINCT FROM OLD."team_id" THEN
    -- Only the category (or the team) changed: the first active status of that category in the
    -- team's set, or none when the team has no set or the set has no such status.
    NEW."status_id" := (
      SELECT s."id" FROM "work_team" t JOIN "work_project_status" s ON s."set_id" = t."project_status_set_id"
      WHERE t."id" = NEW."team_id" AND s."category" = NEW."status" AND s."is_active"
      ORDER BY s."sort_order", s."id" LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.work_project_status_sync() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER work_project_status_before
  BEFORE INSERT OR UPDATE OF "status", "status_id", "team_id" ON "work_project"
  FOR EACH ROW EXECUTE FUNCTION public.work_project_status_sync();
