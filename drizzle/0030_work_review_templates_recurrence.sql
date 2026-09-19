CREATE TABLE "work_deliverable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"url" text,
	"note" text,
	"submitted_by_person_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	CONSTRAINT "work_deliverable_version_unique" UNIQUE("task_id","version")
);
--> statement-breakpoint
ALTER TABLE "work_deliverable" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_recurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rule" jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"lead_days" integer DEFAULT 7 NOT NULL,
	"generated_through" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_recurrence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_template" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "task_template" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "task_template_item" ADD COLUMN "parent_item_id" uuid;--> statement-breakpoint
ALTER TABLE "task_template_item" ADD COLUMN "role_key" text;--> statement-breakpoint
ALTER TABLE "task_template_item" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_deliverable" ADD CONSTRAINT "work_deliverable_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable" ADD CONSTRAINT "work_deliverable_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable" ADD CONSTRAINT "work_deliverable_submitted_by_person_id_person_id_fk" FOREIGN KEY ("submitted_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable" ADD CONSTRAINT "work_deliverable_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_recurrence" ADD CONSTRAINT "work_recurrence_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_recurrence" ADD CONSTRAINT "work_recurrence_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_recurrence" ADD CONSTRAINT "work_recurrence_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_recurrence_project_idx" ON "work_recurrence" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "task_template_item" ADD CONSTRAINT "task_template_item_parent_item_id_task_template_item_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."task_template_item"("id") ON DELETE cascade ON UPDATE no action;