CREATE TABLE "work_checklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_unit_id" uuid,
	"owner_team_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_checklist_one_owner" CHECK ("work_checklist"."owner_unit_id" IS NULL OR "work_checklist"."owner_team_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "work_checklist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_state_checklist" (
	"state_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_state_checklist_state_id_checklist_id_pk" PRIMARY KEY("state_id","checklist_id")
);
--> statement-breakpoint
ALTER TABLE "work_state_checklist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_template_item" ADD COLUMN "checklist_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_handoff_package" ADD COLUMN "checklist_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_intake_form" ADD COLUMN "checklist_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_checklist" ADD CONSTRAINT "work_checklist_owner_unit_id_org_unit_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_checklist" ADD CONSTRAINT "work_checklist_owner_team_id_work_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_checklist" ADD CONSTRAINT "work_checklist_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_state_checklist" ADD CONSTRAINT "work_state_checklist_state_id_work_state_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."work_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_state_checklist" ADD CONSTRAINT "work_state_checklist_checklist_id_work_checklist_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."work_checklist"("id") ON DELETE cascade ON UPDATE no action;