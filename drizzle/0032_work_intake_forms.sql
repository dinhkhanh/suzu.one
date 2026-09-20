CREATE TABLE "work_intake_form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_intake_form" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "intake_form_id" uuid;--> statement-breakpoint
ALTER TABLE "work_intake_form" ADD CONSTRAINT "work_intake_form_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_intake_form" ADD CONSTRAINT "work_intake_form_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_intake_form" ADD CONSTRAINT "work_intake_form_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_intake_form_team_idx" ON "work_intake_form" USING btree ("team_id");