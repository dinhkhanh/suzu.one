-- Digital assets and subscription seats (FR-AST-07 … 11).
--
-- `digital_asset` is the register of what the company owns or runs that has no shelf — pages,
-- channels, ad accounts, websites — and `digital_asset_access` is who may get into each, from the
-- request to the day it was taken away. `licence_seat` says who is using a paid seat: a person or a
-- device. Work points at a digital asset from a task, a project and a post in the publish log.
--
-- Everything is additive: new tables, and one nullable column on `work_publish`. The two columns
-- `licence_seat` supersedes (`licence.seat_holder_person_ids`, `licence.asset_id`) stay, so the
-- code deployed before this migration keeps working; what they held is copied at the end.

CREATE TABLE "work_project_digital_asset" (
	"project_id" uuid NOT NULL,
	"digital_asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_project_digital_asset_project_id_digital_asset_id_pk" PRIMARY KEY("project_id","digital_asset_id")
);
--> statement-breakpoint
ALTER TABLE "work_project_digital_asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_task_digital_asset" (
	"task_id" uuid NOT NULL,
	"digital_asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_task_digital_asset_task_id_digital_asset_id_pk" PRIMARY KEY("task_id","digital_asset_id")
);
--> statement-breakpoint
ALTER TABLE "work_task_digital_asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "digital_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"url" text,
	"entity_id" uuid NOT NULL,
	"ownership" text DEFAULT 'company' NOT NULL,
	"client_id" uuid,
	"owner_person_id" uuid,
	"visibility" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"login_identity" text,
	"recovery_contact" text,
	"credential_location" text,
	"notes" text,
	"rotation_due_since" timestamp with time zone,
	"credentials_rotated_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digital_asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "digital_asset_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digital_asset_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"level" text NOT NULL,
	"method" text DEFAULT 'own_account' NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"granted_at" timestamp with time zone,
	"expires_on" date,
	"ended_at" timestamp with time zone,
	"ended_by_person_id" uuid,
	"end_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digital_asset_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "licence_seat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licence_id" uuid NOT NULL,
	"person_id" uuid,
	"asset_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_person_id" uuid,
	"note" text,
	"released_at" timestamp with time zone,
	"released_by_person_id" uuid,
	"release_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licence_seat_one_holder" CHECK (("licence_seat"."person_id" IS NULL) <> ("licence_seat"."asset_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "licence_seat" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_publish" ADD COLUMN "digital_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "work_project_digital_asset" ADD CONSTRAINT "work_project_digital_asset_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project_digital_asset" ADD CONSTRAINT "work_project_digital_asset_digital_asset_id_digital_asset_id_fk" FOREIGN KEY ("digital_asset_id") REFERENCES "public"."digital_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_digital_asset" ADD CONSTRAINT "work_task_digital_asset_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_digital_asset" ADD CONSTRAINT "work_task_digital_asset_digital_asset_id_digital_asset_id_fk" FOREIGN KEY ("digital_asset_id") REFERENCES "public"."digital_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset" ADD CONSTRAINT "digital_asset_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset" ADD CONSTRAINT "digital_asset_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset" ADD CONSTRAINT "digital_asset_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset_access" ADD CONSTRAINT "digital_asset_access_digital_asset_id_digital_asset_id_fk" FOREIGN KEY ("digital_asset_id") REFERENCES "public"."digital_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset_access" ADD CONSTRAINT "digital_asset_access_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset_access" ADD CONSTRAINT "digital_asset_access_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset_access" ADD CONSTRAINT "digital_asset_access_ended_by_person_id_person_id_fk" FOREIGN KEY ("ended_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence_seat" ADD CONSTRAINT "licence_seat_licence_id_licence_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."licence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence_seat" ADD CONSTRAINT "licence_seat_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence_seat" ADD CONSTRAINT "licence_seat_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence_seat" ADD CONSTRAINT "licence_seat_assigned_by_person_id_person_id_fk" FOREIGN KEY ("assigned_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence_seat" ADD CONSTRAINT "licence_seat_released_by_person_id_person_id_fk" FOREIGN KEY ("released_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_project_digital_asset_asset_idx" ON "work_project_digital_asset" USING btree ("digital_asset_id");--> statement-breakpoint
CREATE INDEX "work_task_digital_asset_asset_idx" ON "work_task_digital_asset" USING btree ("digital_asset_id");--> statement-breakpoint
CREATE INDEX "digital_asset_entity_idx" ON "digital_asset" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "digital_asset_owner_idx" ON "digital_asset" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "digital_asset_client_idx" ON "digital_asset" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digital_asset_access_open_key" ON "digital_asset_access" USING btree ("digital_asset_id","person_id") WHERE "digital_asset_access"."status" in ('requested', 'active');--> statement-breakpoint
CREATE INDEX "digital_asset_access_asset_idx" ON "digital_asset_access" USING btree ("digital_asset_id","status");--> statement-breakpoint
CREATE INDEX "digital_asset_access_person_idx" ON "digital_asset_access" USING btree ("person_id") WHERE "digital_asset_access"."status" in ('requested', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "licence_seat_person_open_key" ON "licence_seat" USING btree ("licence_id","person_id") WHERE "licence_seat"."released_at" is null and "licence_seat"."person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "licence_seat_asset_open_key" ON "licence_seat" USING btree ("licence_id","asset_id") WHERE "licence_seat"."released_at" is null and "licence_seat"."asset_id" is not null;--> statement-breakpoint
CREATE INDEX "licence_seat_licence_idx" ON "licence_seat" USING btree ("licence_id","released_at");--> statement-breakpoint
CREATE INDEX "licence_seat_person_idx" ON "licence_seat" USING btree ("person_id") WHERE "licence_seat"."released_at" is null;--> statement-breakpoint
CREATE INDEX "licence_seat_asset_idx" ON "licence_seat" USING btree ("asset_id") WHERE "licence_seat"."released_at" is null;--> statement-breakpoint
ALTER TABLE "work_publish" ADD CONSTRAINT "work_publish_digital_asset_id_digital_asset_id_fk" FOREIGN KEY ("digital_asset_id") REFERENCES "public"."digital_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_publish_digital_asset_idx" ON "work_publish" USING btree ("digital_asset_id");--> statement-breakpoint
-- Hand-written: the work schema imports the asset schema for the links above, so the asset schema
-- cannot import `work_client` back for this one.
ALTER TABLE "digital_asset" ADD CONSTRAINT "digital_asset_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- What the two superseded columns held becomes seats. Only of subscriptions still running: one that
-- has ended has no seats to hold.
INSERT INTO "licence_seat" ("licence_id", "person_id")
SELECT DISTINCT l."id", holder
FROM "licence" l CROSS JOIN LATERAL unnest(l."seat_holder_person_ids") AS holder
WHERE l."status" = 'active' AND EXISTS (SELECT 1 FROM "person" p WHERE p."id" = holder);--> statement-breakpoint
INSERT INTO "licence_seat" ("licence_id", "asset_id")
SELECT l."id", l."asset_id" FROM "licence" l WHERE l."status" = 'active' AND l."asset_id" IS NOT NULL;
