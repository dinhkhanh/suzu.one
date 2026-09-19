CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"assignee_person_id" uuid,
	"due_date" date,
	"priority" smallint,
	"entity_id" uuid,
	"parent_task_id" uuid,
	"context_type" text,
	"context_id" text,
	"subject_person_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"template_item_id" uuid,
	"created_by_person_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"entity_id" uuid,
	"department_id" uuid,
	"position_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_template_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_rule" text NOT NULL,
	"assignee_person_id" uuid,
	"due_offset_days" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_template_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_person_id_person_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_task_id_task_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_subject_person_id_person_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_template_item_id_task_template_item_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."task_template_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_completed_by_person_id_person_id_fk" FOREIGN KEY ("completed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_template_item" ADD CONSTRAINT "task_template_item_template_id_task_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_template_item" ADD CONSTRAINT "task_template_item_assignee_person_id_person_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignee_open_idx" ON "task" USING btree ("assignee_person_id","due_date") WHERE "task"."deleted_at" IS NULL AND "task"."status" IN ('todo', 'in_progress');--> statement-breakpoint
CREATE INDEX "task_context_idx" ON "task" USING btree ("context_type","context_id");--> statement-breakpoint
CREATE INDEX "task_subject_idx" ON "task" USING btree ("subject_person_id");--> statement-breakpoint
CREATE INDEX "task_template_purpose_idx" ON "task_template" USING btree ("purpose");--> statement-breakpoint
CREATE INDEX "task_template_item_template_idx" ON "task_template_item" USING btree ("template_id");