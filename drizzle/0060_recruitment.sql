CREATE TABLE "application_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "application_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"actor_person_id" uuid,
	"note" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"search_name" text NOT NULL,
	"email" text,
	"phone" text,
	"email_key" text,
	"phone_key" text,
	"current_title" text,
	"current_employer" text,
	"location" text,
	"links" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"source_detail" text,
	"referred_by_person_id" uuid,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"consent_at" timestamp with time zone,
	"consent_version" text,
	"talent_pool_consent" boolean DEFAULT false NOT NULL,
	"retain_until" date,
	"anonymised_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hiring_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"department_id" uuid,
	"team_id" uuid,
	"position_title" text NOT NULL,
	"job_level" text,
	"headcount" integer DEFAULT 1 NOT NULL,
	"employment_type" text DEFAULT 'employee' NOT NULL,
	"work_location" text,
	"reason" text NOT NULL,
	"target_start_date" date,
	"budget_min_vnd" bigint,
	"budget_max_vnd" bigint,
	"requested_by_person_id" uuid NOT NULL,
	"hiring_manager_person_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_request_id" uuid,
	"opening_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hiring_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'careers_page' NOT NULL,
	"source_detail" text,
	"cover_letter" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cv_file_id" uuid,
	"portfolio_links" text[] DEFAULT '{}' NOT NULL,
	"salary_expectation_vnd" bigint,
	"salary_expectation_note" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejection_reason" text,
	"rejection_note" text,
	"closed_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"hired_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_application" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_opening" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"title_en" text,
	"entity_id" uuid NOT NULL,
	"department_id" uuid,
	"team_id" uuid,
	"position_name" text,
	"job_level" text,
	"employment_type" text DEFAULT 'employee' NOT NULL,
	"work_mode" text DEFAULT 'onsite' NOT NULL,
	"work_location" text,
	"headcount" integer DEFAULT 1 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"benefits" text DEFAULT '' NOT NULL,
	"salary_min_vnd" bigint,
	"salary_max_vnd" bigint,
	"salary_public" boolean DEFAULT false NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"hiring_request_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"public_slug" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_start_date" date,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_opening_code_unique" UNIQUE("code"),
	CONSTRAINT "job_opening_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
ALTER TABLE "job_opening" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_opening_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opening_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_opening_member_key" UNIQUE("opening_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "job_opening_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recruit_pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruit_pipeline_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "recruit_pipeline" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recruit_pipeline_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"sort_order" smallint NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruit_pipeline_stage_key" UNIQUE("pipeline_id","key")
);
--> statement-breakpoint
ALTER TABLE "recruit_pipeline_stage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_application_id_job_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_from_stage_id_recruit_pipeline_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."recruit_pipeline_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_to_stage_id_recruit_pipeline_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."recruit_pipeline_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_referred_by_person_id_person_id_fk" FOREIGN KEY ("referred_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD CONSTRAINT "hiring_request_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD CONSTRAINT "hiring_request_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD CONSTRAINT "hiring_request_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD CONSTRAINT "hiring_request_requested_by_person_id_person_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD CONSTRAINT "hiring_request_hiring_manager_person_id_person_id_fk" FOREIGN KEY ("hiring_manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD CONSTRAINT "hiring_request_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_opening_id_job_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_opening"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_stage_id_recruit_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."recruit_pipeline_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_hired_person_id_person_id_fk" FOREIGN KEY ("hired_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_pipeline_id_recruit_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."recruit_pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_hiring_request_id_hiring_request_id_fk" FOREIGN KEY ("hiring_request_id") REFERENCES "public"."hiring_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening_member" ADD CONSTRAINT "job_opening_member_opening_id_job_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_opening"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_opening_member" ADD CONSTRAINT "job_opening_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_pipeline_stage" ADD CONSTRAINT "recruit_pipeline_stage_pipeline_id_recruit_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."recruit_pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_event_application_idx" ON "application_event" USING btree ("application_id","id");--> statement-breakpoint
CREATE INDEX "candidate_email_key_idx" ON "candidate" USING btree ("email_key");--> statement-breakpoint
CREATE INDEX "candidate_phone_key_idx" ON "candidate" USING btree ("phone_key");--> statement-breakpoint
CREATE INDEX "candidate_search_name_idx" ON "candidate" USING btree ("search_name");--> statement-breakpoint
CREATE INDEX "candidate_retention_idx" ON "candidate" USING btree ("retain_until","anonymised_at");--> statement-breakpoint
CREATE INDEX "hiring_request_entity_idx" ON "hiring_request" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "hiring_request_requester_idx" ON "hiring_request" USING btree ("requested_by_person_id","created_at");--> statement-breakpoint
CREATE INDEX "hiring_request_approval_idx" ON "hiring_request" USING btree ("approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_application_candidate_opening_key" ON "job_application" USING btree ("candidate_id","opening_id");--> statement-breakpoint
CREATE INDEX "job_application_opening_idx" ON "job_application" USING btree ("opening_id","status","stage_id");--> statement-breakpoint
CREATE INDEX "job_application_candidate_idx" ON "job_application" USING btree ("candidate_id","applied_at");--> statement-breakpoint
CREATE INDEX "job_opening_entity_idx" ON "job_opening" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "job_opening_department_idx" ON "job_opening" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "job_opening_status_idx" ON "job_opening" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "job_opening_member_person_idx" ON "job_opening_member" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "recruit_pipeline_active_idx" ON "recruit_pipeline" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "recruit_pipeline_stage_order_idx" ON "recruit_pipeline_stage" USING btree ("pipeline_id","sort_order");