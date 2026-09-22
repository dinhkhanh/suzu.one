CREATE TABLE "project_template_plan" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'client' NOT NULL,
	"phases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deliverables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_by_role" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"update_cadence_days" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_template_plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_plan" ADD COLUMN "budget_by_role" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_template_plan" ADD CONSTRAINT "project_template_plan_template_id_task_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_template"("id") ON DELETE cascade ON UPDATE no action;