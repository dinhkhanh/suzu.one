CREATE TABLE "work_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_person_id" uuid,
	"type" text NOT NULL,
	"field" text,
	"from_value" jsonb,
	"to_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'client' NOT NULL,
	"parent_id" uuid,
	"entity_id" uuid,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_client_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "work_client" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_comment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_label" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"entity_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"client_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'team' NOT NULL,
	"lead_person_id" uuid,
	"start_date" date,
	"due_date" date,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_project" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_project_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_project_member_unique" UNIQUE("project_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "work_project_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"layout" text DEFAULT 'list' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_saved_view" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_task" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"number" integer NOT NULL,
	"state_id" uuid NOT NULL,
	"client_id" uuid,
	"channel" text,
	"content_format" text,
	"board_rank" double precision DEFAULT 0 NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" text DEFAULT 'none' NOT NULL,
	"reviewer_person_id" uuid,
	"revision_rounds" integer DEFAULT 0 NOT NULL,
	"recurrence_id" uuid,
	"occurrence_date" date,
	CONSTRAINT "work_task_number_unique" UNIQUE("team_id","number")
);
--> statement-breakpoint
ALTER TABLE "work_task" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_task_dependency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_task_id" uuid NOT NULL,
	"blocked_task_id" uuid NOT NULL,
	"type" text DEFAULT 'blocks' NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_task_dependency_unique" UNIQUE("blocker_task_id","blocked_task_id")
);
--> statement-breakpoint
ALTER TABLE "work_task_dependency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_task_label" (
	"task_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "work_task_label_task_id_label_id_pk" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "work_task_label" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_task_person" (
	"task_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'collaborator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_task_person_task_id_person_id_pk" PRIMARY KEY("task_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "work_task_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entity_id" uuid,
	"department_id" uuid,
	"default_visibility" text DEFAULT 'team' NOT NULL,
	"task_seq" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_team_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "work_team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_team_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_team_member_unique" UNIQUE("team_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "work_team_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "requester_person_id" uuid;--> statement-breakpoint
ALTER TABLE "work_activity" ADD CONSTRAINT "work_activity_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_activity" ADD CONSTRAINT "work_activity_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_client" ADD CONSTRAINT "work_client_parent_id_work_client_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_client" ADD CONSTRAINT "work_client_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_comment" ADD CONSTRAINT "work_comment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_comment" ADD CONSTRAINT "work_comment_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_comment" ADD CONSTRAINT "work_comment_parent_id_work_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_comment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_label" ADD CONSTRAINT "work_label_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_lead_person_id_person_id_fk" FOREIGN KEY ("lead_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project" ADD CONSTRAINT "work_project_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project_member" ADD CONSTRAINT "work_project_member_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_project_member" ADD CONSTRAINT "work_project_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_saved_view" ADD CONSTRAINT "work_saved_view_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_saved_view" ADD CONSTRAINT "work_saved_view_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_state" ADD CONSTRAINT "work_state_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_state_id_work_state_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."work_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_reviewer_person_id_person_id_fk" FOREIGN KEY ("reviewer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_dependency" ADD CONSTRAINT "work_task_dependency_blocker_task_id_task_id_fk" FOREIGN KEY ("blocker_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_dependency" ADD CONSTRAINT "work_task_dependency_blocked_task_id_task_id_fk" FOREIGN KEY ("blocked_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_dependency" ADD CONSTRAINT "work_task_dependency_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_label" ADD CONSTRAINT "work_task_label_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_label" ADD CONSTRAINT "work_task_label_label_id_work_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."work_label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_person" ADD CONSTRAINT "work_task_person_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_person" ADD CONSTRAINT "work_task_person_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_team" ADD CONSTRAINT "work_team_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_team" ADD CONSTRAINT "work_team_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_team_member" ADD CONSTRAINT "work_team_member_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_team_member" ADD CONSTRAINT "work_team_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_activity_task_idx" ON "work_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "work_client_parent_idx" ON "work_client" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "work_comment_task_idx" ON "work_comment" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "work_label_team_idx" ON "work_label" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "work_project_team_idx" ON "work_project" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "work_project_client_idx" ON "work_project" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "work_project_member_person_idx" ON "work_project_member" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "work_saved_view_project_idx" ON "work_saved_view" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_state_team_idx" ON "work_state" USING btree ("team_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "work_task_occurrence_unique" ON "work_task" USING btree ("recurrence_id","occurrence_date") WHERE "work_task"."recurrence_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_task_project_idx" ON "work_task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_task_state_idx" ON "work_task" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "work_task_client_idx" ON "work_task" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "work_task_dependency_blocked_idx" ON "work_task_dependency" USING btree ("blocked_task_id");--> statement-breakpoint
CREATE INDEX "work_task_label_label_idx" ON "work_task_label" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "work_task_person_person_idx" ON "work_task_person" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "work_team_entity_idx" ON "work_team" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "work_team_member_person_idx" ON "work_team_member" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_requester_person_id_person_id_fk" FOREIGN KEY ("requester_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_parent_idx" ON "task" USING btree ("parent_task_id");