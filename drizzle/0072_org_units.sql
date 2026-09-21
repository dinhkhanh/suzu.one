-- One org-unit tree (SRS D19, D20, FR-PLT-16, FR-KB-13..16).
--
-- `department` and `team` become one table, `org_unit`, whose rows nest to any depth. The rename
-- and the fold-in keep every existing id, so every `department_id` and `team_id` elsewhere in the
-- database — and every `department:<id>` / `team:<id>` subject key, and every role grant's
-- `scope_id` — still points at the same unit afterwards. Nothing has to be re-entered.
--
-- The tree is then carried by two derived things the application never writes:
--   · `org_unit.path` — the unit and its ancestors, root first;
--   · `person.org_unit_path` / `department_id` / `team_id` — the same chain for the person, plus
--     the deepest unit of each kind on it, which is what reports still group by.
-- Both are kept true by triggers, including when a unit is moved to a different parent.

CREATE TYPE "public"."org_unit_kind" AS ENUM('department', 'team');--> statement-breakpoint

-- ── The table ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE "department" RENAME TO "org_unit";--> statement-breakpoint
ALTER TABLE "org_unit" RENAME CONSTRAINT "department_code_unique" TO "org_unit_code_unique";--> statement-breakpoint
ALTER TABLE "org_unit" RENAME CONSTRAINT "department_parent_id_department_id_fk" TO "org_unit_parent_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "org_unit" RENAME CONSTRAINT "department_entity_id_entity_id_fk" TO "org_unit_entity_id_entity_id_fk";--> statement-breakpoint
ALTER INDEX "department_entity_id_idx" RENAME TO "org_unit_entity_id_idx";--> statement-breakpoint
ALTER TABLE "org_unit" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "org_unit" ADD COLUMN "kind" "org_unit_kind" DEFAULT 'department' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_unit" ADD COLUMN "path" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "org_unit_parent_idx" ON "org_unit" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "org_unit_path_idx" ON "org_unit" USING gin ("path");--> statement-breakpoint

-- Teams move in under the department they belonged to, keeping their ids.
INSERT INTO "org_unit" ("id", "code", "name", "kind", "parent_id", "entity_id", "is_active", "created_at", "updated_at")
SELECT t."id", NULL, t."name", 'team', t."department_id", d."entity_id", t."is_active", t."created_at", t."updated_at"
FROM "team" t JOIN "org_unit" d ON d."id" = t."department_id";--> statement-breakpoint

-- ── The path, and what the application reads off it ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION org_unit_path_set() RETURNS trigger AS $$
DECLARE parent_path uuid[];
BEGIN
  IF NEW."parent_id" IS NULL THEN
    NEW."path" := ARRAY[NEW."id"];
  ELSE
    SELECT p."path" INTO parent_path FROM "org_unit" p WHERE p."id" = NEW."parent_id";
    IF parent_path IS NULL THEN RAISE EXCEPTION 'org_unit parent % not found', NEW."parent_id"; END IF;
    IF NEW."id" = ANY(parent_path) THEN RAISE EXCEPTION 'org_unit % cannot sit inside itself', NEW."id"; END IF;
    NEW."path" := parent_path || NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER org_unit_path_before
  BEFORE INSERT OR UPDATE OF "parent_id", "id" ON "org_unit"
  FOR EACH ROW EXECUTE FUNCTION org_unit_path_set();--> statement-breakpoint
-- Backfill: roots first, then each level, so every parent path exists before its children read it.
WITH RECURSIVE walk AS (
  SELECT "id", ARRAY["id"] AS path FROM "org_unit" WHERE "parent_id" IS NULL
  UNION ALL
  SELECT c."id", w.path || c."id" FROM "org_unit" c JOIN walk w ON c."parent_id" = w."id"
)
UPDATE "org_unit" SET "path" = walk.path FROM walk WHERE "org_unit"."id" = walk."id";--> statement-breakpoint

-- ── Where a person sits ─────────────────────────────────────────────────────────────────────
ALTER TABLE "person" ADD COLUMN "org_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "org_unit_path" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "org_unit_id" uuid;--> statement-breakpoint

CREATE OR REPLACE FUNCTION person_placement_set() RETURNS trigger AS $$
DECLARE unit_path uuid[];
BEGIN
  IF NEW."org_unit_id" IS NULL THEN
    NEW."org_unit_path" := '{}'::uuid[];
    NEW."department_id" := NULL;
    NEW."team_id" := NULL;
    RETURN NEW;
  END IF;
  SELECT u."path" INTO unit_path FROM "org_unit" u WHERE u."id" = NEW."org_unit_id";
  IF unit_path IS NULL THEN RAISE EXCEPTION 'org_unit % not found', NEW."org_unit_id"; END IF;
  NEW."org_unit_path" := unit_path;
  -- The deepest unit of each kind on the way down: what reports group by and a payslip prints.
  SELECT u."id" INTO NEW."department_id" FROM "org_unit" u
    WHERE u."id" = ANY(unit_path) AND u."kind" = 'department'
    ORDER BY array_position(unit_path, u."id") DESC LIMIT 1;
  SELECT u."id" INTO NEW."team_id" FROM "org_unit" u
    WHERE u."id" = ANY(unit_path) AND u."kind" = 'team'
    ORDER BY array_position(unit_path, u."id") DESC LIMIT 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER person_placement_before
  BEFORE INSERT OR UPDATE OF "org_unit_id" ON "person"
  FOR EACH ROW EXECUTE FUNCTION person_placement_set();--> statement-breakpoint

-- The unit someone is in is the deepest one their old placement named.
UPDATE "person" SET "org_unit_id" = COALESCE("team_id", "department_id");--> statement-breakpoint
UPDATE "assignment" SET "org_unit_id" = COALESCE("team_id", "department_id");--> statement-breakpoint
CREATE INDEX "person_org_unit_path_idx" ON "person" USING gin ("org_unit_path");--> statement-breakpoint

-- The cascade comes last: it touches `person`, so it may only exist once the columns above do,
-- and the backfills above must not fire it.
-- Moving a unit moves everything under it: the subtree is rewritten parent-first, so each row
-- reads a parent path that is already correct.
CREATE OR REPLACE FUNCTION org_unit_path_cascade() RETURNS trigger AS $$
DECLARE child record;
BEGIN
  FOR child IN
    SELECT c."id" FROM "org_unit" c
    WHERE c."path" @> ARRAY[NEW."id"] AND c."id" <> NEW."id"
    ORDER BY array_length(c."path", 1)
  LOOP
    UPDATE "org_unit" SET "path" = (SELECT p."path" FROM "org_unit" p WHERE p."id" = "org_unit"."parent_id") || "org_unit"."id"
    WHERE "id" = child."id";
  END LOOP;
  -- Everyone in the subtree follows their unit to its new place.
  UPDATE "person" SET "org_unit_id" = "org_unit_id" WHERE "org_unit_path" @> ARRAY[NEW."id"];
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Plain AFTER UPDATE, not `AFTER UPDATE OF "path"`: the path is set by the BEFORE trigger above,
-- and `UPDATE OF` only fires for columns the statement itself names. The WHEN clause reads the
-- row as the BEFORE trigger left it, so the cascade runs exactly when the path really moved.
CREATE TRIGGER org_unit_path_after
  AFTER UPDATE ON "org_unit"
  FOR EACH ROW WHEN (OLD."path" IS DISTINCT FROM NEW."path") EXECUTE FUNCTION org_unit_path_cascade();--> statement-breakpoint


-- ── Every foreign key now points at the one table ───────────────────────────────────────────
ALTER TABLE "person" DROP CONSTRAINT "person_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "assignment" DROP CONSTRAINT "assignment_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "team_staffing_rule" DROP CONSTRAINT "team_staffing_rule_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "goal" DROP CONSTRAINT "goal_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "hiring_request" DROP CONSTRAINT "hiring_request_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "job_opening" DROP CONSTRAINT "job_opening_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "job_offer" DROP CONSTRAINT "job_offer_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "asset_assignment" DROP CONSTRAINT "asset_assignment_holder_team_id_team_id_fk";--> statement-breakpoint
DROP TABLE "team" CASCADE;--> statement-breakpoint

ALTER TABLE "person" RENAME CONSTRAINT "person_department_id_department_id_fk" TO "person_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "assignment" RENAME CONSTRAINT "assignment_department_id_department_id_fk" TO "assignment_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "schedule_assignment" RENAME CONSTRAINT "schedule_assignment_department_id_department_id_fk" TO "schedule_assignment_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "team_staffing_rule" RENAME CONSTRAINT "team_staffing_rule_department_id_department_id_fk" TO "team_staffing_rule_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "task_template" RENAME CONSTRAINT "task_template_department_id_department_id_fk" TO "task_template_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "work_team" RENAME CONSTRAINT "work_team_department_id_department_id_fk" TO "work_team_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "goal" RENAME CONSTRAINT "goal_department_id_department_id_fk" TO "goal_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "hiring_request" RENAME CONSTRAINT "hiring_request_department_id_department_id_fk" TO "hiring_request_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "job_opening" RENAME CONSTRAINT "job_opening_department_id_department_id_fk" TO "job_opening_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "job_offer" RENAME CONSTRAINT "job_offer_department_id_department_id_fk" TO "job_offer_department_id_org_unit_id_fk";--> statement-breakpoint
ALTER TABLE "review_participant" RENAME CONSTRAINT "review_participant_department_id_department_id_fk" TO "review_participant_department_id_org_unit_id_fk";--> statement-breakpoint

ALTER TABLE "person" ADD CONSTRAINT "person_org_unit_id_org_unit_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_team_id_org_unit_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_org_unit_id_org_unit_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_team_id_org_unit_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staffing_rule" ADD CONSTRAINT "team_staffing_rule_team_id_org_unit_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_team_id_org_unit_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD CONSTRAINT "hiring_request_team_id_org_unit_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_team_id_org_unit_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_team_id_org_unit_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_holder_team_id_org_unit_id_fk" FOREIGN KEY ("holder_team_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── One scope, one subject key ──────────────────────────────────────────────────────────────
-- A grant on a department or a team becomes a grant on that unit — and now reaches everything
-- below it, which is the point of the change (FR-PLT-16).
ALTER TYPE "public"."scope_type" RENAME TO "scope_type_old";--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('group', 'entity', 'unit');--> statement-breakpoint
ALTER TABLE "role_assignment" ALTER COLUMN "scope_type" TYPE "public"."scope_type"
  USING (CASE WHEN "scope_type"::text IN ('department', 'team') THEN 'unit' ELSE "scope_type"::text END)::"public"."scope_type";--> statement-breakpoint
DROP TYPE "public"."scope_type_old";--> statement-breakpoint

-- The same for every audience: "department:<id>" and "team:<id>" are now "unit:<id>", which covers
-- the unit and everything below it. Nobody loses access; some people gain what the tree implies.
UPDATE "kb_access" SET "subject_key" = 'unit:' || split_part("subject_key", ':', 2) WHERE "subject_key" LIKE 'department:%' OR "subject_key" LIKE 'team:%';--> statement-breakpoint
UPDATE "kb_ack_audience" SET "subject_key" = 'unit:' || split_part("subject_key", ':', 2) WHERE "subject_key" LIKE 'department:%' OR "subject_key" LIKE 'team:%';--> statement-breakpoint
UPDATE "announcement_audience" SET "subject_key" = 'unit:' || split_part("subject_key", ':', 2) WHERE "subject_key" LIKE 'department:%' OR "subject_key" LIKE 'team:%';--> statement-breakpoint

ALTER TABLE "org_unit" ENABLE ROW LEVEL SECURITY;
