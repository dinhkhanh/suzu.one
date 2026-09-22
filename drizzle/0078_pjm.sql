CREATE TABLE "work_automation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_automation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_automation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"task_id" uuid,
	"trigger" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_automation_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_blocker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"needed_person_id" uuid,
	"raised_by_person_id" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_person_id" uuid,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "work_blocker" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_cover_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"cover_person_id" uuid,
	"handoff_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"handed_back_at" timestamp with time zone,
	CONSTRAINT "work_cover_item_unique" UNIQUE("plan_id","item_type","item_id")
);
--> statement-breakpoint
ALTER TABLE "work_cover_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_cover_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_request_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"default_cover_person_id" uuid,
	"note" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_cover_plan_leave_request_id_unique" UNIQUE("leave_request_id")
);
--> statement-breakpoint
ALTER TABLE "work_cover_plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_custom_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"project_id" uuid,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"show_on_card" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_custom_field" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"summary" jsonb,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_cycle_number_unique" UNIQUE("team_id","number")
);
--> statement-breakpoint
ALTER TABLE "work_cycle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_deliverable_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"stage_index" integer DEFAULT 0 NOT NULL,
	"stage_name" text,
	"decision" text NOT NULL,
	"decided_by_person_id" uuid NOT NULL,
	"comment" text,
	"is_client" boolean DEFAULT false NOT NULL,
	"client" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_deliverable_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_deliverable_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"x" double precision,
	"y" double precision,
	"timecode_ms" integer,
	"body" text NOT NULL,
	"author_person_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_deliverable_pin" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"delivered_on" date NOT NULL,
	"delivered_by_person_id" uuid NOT NULL,
	"recipient" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_exit_handover" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"lifecycle_event_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"last_day" date,
	"task_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_exit_handover_lifecycle_event_id_unique" UNIQUE("lifecycle_event_id")
);
--> statement-breakpoint
ALTER TABLE "work_exit_handover" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_handoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"package_id" uuid,
	"from_person_id" uuid,
	"to_person_id" uuid,
	"to_team_id" uuid,
	"from_state_id" uuid,
	"to_state_id" uuid,
	"note" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"package_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"responded_by_person_id" uuid,
	"responded_at" timestamp with time zone,
	"return_reason" text,
	"target_task_id" uuid,
	"source_ref" jsonb,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_handoff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_handoff_package" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from_state_id" uuid,
	"to_state_id" uuid NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_link" boolean DEFAULT false NOT NULL,
	"require_file" boolean DEFAULT false NOT NULL,
	"require_accept" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_handoff_package" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_publish" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"page" text,
	"planned_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"url" text,
	"published_by_person_id" uuid,
	"boosted" boolean DEFAULT false NOT NULL,
	"ad_account" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_publish" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_publish_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publish_id" uuid NOT NULL,
	"recorded_on" date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_publish_result" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_review_chain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid,
	"project_id" uuid,
	"name" text NOT NULL,
	"content_format" text,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_review_chain" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_task_number_alias" (
	"team_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_task_number_alias_team_id_number_pk" PRIMARY KEY("team_id","number")
);
--> statement-breakpoint
ALTER TABLE "work_task_number_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_triage_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"match" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"set" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_triage_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"scope" text NOT NULL,
	"milestone_id" uuid,
	"retainer_period_id" uuid,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_file_id" uuid,
	"signed_file_id" uuid,
	"signed_by_client" text,
	"sent_at" timestamp with time zone,
	"signed_on" date,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_acceptance_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
ALTER TABLE "project_acceptance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_billing_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_id" uuid,
	"job_number" text,
	"client_id" uuid,
	"source" text NOT NULL,
	"acceptance_id" uuid,
	"milestone_id" uuid,
	"retainer_period_id" uuid,
	"description" text NOT NULL,
	"reference" text,
	"amount_vnd" bigint,
	"status" text DEFAULT 'ready' NOT NULL,
	"invoice_number" text,
	"invoice_date" date,
	"waived_reason" text,
	"created_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_billing_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid,
	"placeholder_role" text,
	"week_start" date NOT NULL,
	"minutes" integer NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_booking" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"requested_by" text DEFAULT 'client' NOT NULL,
	"impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_file_id" uuid,
	"evidence_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approval_request_id" uuid,
	"applied_at" timestamp with time zone,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_change_request_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
ALTER TABLE "project_change_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_client_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"summary" text,
	"next_plan" text,
	"file_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_client_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_deliverable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"retainer_period_id" uuid,
	"milestone_id" uuid,
	"title" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"format" text,
	"channel" text,
	"due_date" date,
	"change_request_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_deliverable" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_job_counter" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "project_job_counter_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
ALTER TABLE "project_job_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_meeting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text DEFAULT 'weekly' NOT NULL,
	"title" text NOT NULL,
	"held_on" date NOT NULL,
	"attendee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_attendees" text,
	"agenda" text,
	"notes" text,
	"retro" jsonb,
	"calendar_event_id" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_meeting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_meeting_task" (
	"meeting_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	CONSTRAINT "project_meeting_task_meeting_id_task_id_pk" PRIMARY KEY("meeting_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "project_meeting_task" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"name" text NOT NULL,
	"due_date" date,
	"owner_person_id" uuid,
	"is_client_facing" boolean DEFAULT false NOT NULL,
	"is_billing" boolean DEFAULT false NOT NULL,
	"billing_amount_vnd" bigint,
	"done_at" timestamp with time zone,
	"done_by_person_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notified" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_milestone" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_phase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"budget_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_phase" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_plan" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'client' NOT NULL,
	"job_number" text,
	"account_manager_person_id" uuid,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief_status" text DEFAULT 'draft' NOT NULL,
	"brief_approval_request_id" uuid,
	"brief_approved_at" timestamp with time zone,
	"budget_minutes" integer,
	"fee_vnd" bigint,
	"budget_alerted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"baseline" jsonb,
	"health" text,
	"health_updated_at" timestamp with time zone,
	"update_cadence_days" integer DEFAULT 7 NOT NULL,
	"drive_url" text,
	"kb_space_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by_person_id" uuid,
	"close_report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_plan_job_number_unique" UNIQUE("job_number")
);
--> statement-breakpoint
ALTER TABLE "project_plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_raid_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_person_id" uuid,
	"due_date" date,
	"severity" text,
	"status" text DEFAULT 'open' NOT NULL,
	"task_id" uuid,
	"decided_on" date,
	"evidence_url" text,
	"evidence_file_id" uuid,
	"meeting_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_raid_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_retainer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid,
	"start_month" text NOT NULL,
	"end_month" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minutes_per_month" integer,
	"fee_per_month_vnd" bigint,
	"rollover" text DEFAULT 'reset' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_retainer_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_retainer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_retainer_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retainer_id" uuid NOT NULL,
	"month" text NOT NULL,
	"minutes_allowance" integer,
	"carried" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alerted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_retainer_period_unique" UNIQUE("retainer_id","month")
);
--> statement-breakpoint
ALTER TABLE "project_retainer_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_status_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"health" text NOT NULL,
	"summary" text NOT NULL,
	"highlights" text,
	"next_steps" text,
	"facts" jsonb NOT NULL,
	"author_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_status_update" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_task_link" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"milestone_id" uuid,
	"deliverable_id" uuid,
	"phase_id" uuid,
	"baseline_start" date,
	"baseline_due" date
);
--> statement-breakpoint
ALTER TABLE "project_task_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_plan_unique" UNIQUE("person_id","date")
);
--> statement-breakpoint
ALTER TABLE "daily_plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_reminder_sent" (
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_on" date NOT NULL,
	CONSTRAINT "daily_reminder_sent_person_id_kind_sent_on_pk" PRIMARY KEY("person_id","kind","sent_on")
);
--> statement-breakpoint
ALTER TABLE "daily_reminder_sent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"activity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"not_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blockers" text,
	"notes" text,
	"tomorrow" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minutes_logged" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"seconds_to_submit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_report_unique" UNIQUE("person_id","date")
);
--> statement-breakpoint
ALTER TABLE "daily_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_report_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"body" text NOT NULL,
	"reaction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_report_comment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_team_policy" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"plan_mode" text DEFAULT 'optional' NOT NULL,
	"report_mode" text DEFAULT 'required' NOT NULL,
	"report_days" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"plan_cutoff" text DEFAULT '09:30' NOT NULL,
	"report_deadline" text DEFAULT '18:30' NOT NULL,
	"time_mode" text DEFAULT 'optional' NOT NULL,
	"timesheet_approval" boolean DEFAULT false NOT NULL,
	"cover_min_days" integer DEFAULT 2 NOT NULL,
	"cycle_weeks" integer,
	"cycle_start" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_team_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_weekly_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"author_person_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_weekly_report_unique" UNIQUE("subject_type","subject_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "daily_weekly_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"week_start" date NOT NULL,
	"task_id" uuid,
	"project_id" uuid,
	"category" text,
	"minutes" integer DEFAULT 0 NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"timer_started_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timesheet_week" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_week_unique" UNIQUE("person_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "timesheet_week" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_client" ADD COLUMN "account_manager_person_id" uuid;--> statement-breakpoint
ALTER TABLE "work_deliverable" ADD COLUMN "chain_id" uuid;--> statement-breakpoint
ALTER TABLE "work_deliverable" ADD COLUMN "stage_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_deliverable" ADD COLUMN "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "custom_values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "triage_status" text;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "triage_source" text;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "triage_snoozed_until" date;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "triage_decided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "triage_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "triage_note" text;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "work_task" ADD COLUMN "cycle_rollovers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kpi_definition" ADD COLUMN "work_metric" text;--> statement-breakpoint
ALTER TABLE "work_automation" ADD CONSTRAINT "work_automation_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_automation" ADD CONSTRAINT "work_automation_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_automation" ADD CONSTRAINT "work_automation_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_automation_run" ADD CONSTRAINT "work_automation_run_automation_id_work_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."work_automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_automation_run" ADD CONSTRAINT "work_automation_run_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blocker" ADD CONSTRAINT "work_blocker_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blocker" ADD CONSTRAINT "work_blocker_needed_person_id_person_id_fk" FOREIGN KEY ("needed_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blocker" ADD CONSTRAINT "work_blocker_raised_by_person_id_person_id_fk" FOREIGN KEY ("raised_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blocker" ADD CONSTRAINT "work_blocker_resolved_by_person_id_person_id_fk" FOREIGN KEY ("resolved_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_cover_item" ADD CONSTRAINT "work_cover_item_plan_id_work_cover_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."work_cover_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_cover_item" ADD CONSTRAINT "work_cover_item_cover_person_id_person_id_fk" FOREIGN KEY ("cover_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_cover_item" ADD CONSTRAINT "work_cover_item_handoff_id_work_handoff_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."work_handoff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_cover_plan" ADD CONSTRAINT "work_cover_plan_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_cover_plan" ADD CONSTRAINT "work_cover_plan_default_cover_person_id_person_id_fk" FOREIGN KEY ("default_cover_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_custom_field" ADD CONSTRAINT "work_custom_field_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_custom_field" ADD CONSTRAINT "work_custom_field_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_custom_field" ADD CONSTRAINT "work_custom_field_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_cycle" ADD CONSTRAINT "work_cycle_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable_decision" ADD CONSTRAINT "work_deliverable_decision_deliverable_id_work_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."work_deliverable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable_decision" ADD CONSTRAINT "work_deliverable_decision_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable_pin" ADD CONSTRAINT "work_deliverable_pin_deliverable_id_work_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."work_deliverable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable_pin" ADD CONSTRAINT "work_deliverable_pin_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_deliverable_pin" ADD CONSTRAINT "work_deliverable_pin_resolved_by_person_id_person_id_fk" FOREIGN KEY ("resolved_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_delivery" ADD CONSTRAINT "work_delivery_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_delivery" ADD CONSTRAINT "work_delivery_deliverable_id_work_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."work_deliverable"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_delivery" ADD CONSTRAINT "work_delivery_delivered_by_person_id_person_id_fk" FOREIGN KEY ("delivered_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_exit_handover" ADD CONSTRAINT "work_exit_handover_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_exit_handover" ADD CONSTRAINT "work_exit_handover_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_package_id_work_handoff_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."work_handoff_package"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_from_person_id_person_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_to_person_id_person_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_to_team_id_work_team_id_fk" FOREIGN KEY ("to_team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_from_state_id_work_state_id_fk" FOREIGN KEY ("from_state_id") REFERENCES "public"."work_state"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_to_state_id_work_state_id_fk" FOREIGN KEY ("to_state_id") REFERENCES "public"."work_state"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_responded_by_person_id_person_id_fk" FOREIGN KEY ("responded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_target_task_id_task_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff_package" ADD CONSTRAINT "work_handoff_package_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff_package" ADD CONSTRAINT "work_handoff_package_from_state_id_work_state_id_fk" FOREIGN KEY ("from_state_id") REFERENCES "public"."work_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff_package" ADD CONSTRAINT "work_handoff_package_to_state_id_work_state_id_fk" FOREIGN KEY ("to_state_id") REFERENCES "public"."work_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_handoff_package" ADD CONSTRAINT "work_handoff_package_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_publish" ADD CONSTRAINT "work_publish_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_publish" ADD CONSTRAINT "work_publish_published_by_person_id_person_id_fk" FOREIGN KEY ("published_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_publish" ADD CONSTRAINT "work_publish_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_publish_result" ADD CONSTRAINT "work_publish_result_publish_id_work_publish_id_fk" FOREIGN KEY ("publish_id") REFERENCES "public"."work_publish"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_publish_result" ADD CONSTRAINT "work_publish_result_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_review_chain" ADD CONSTRAINT "work_review_chain_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_review_chain" ADD CONSTRAINT "work_review_chain_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_review_chain" ADD CONSTRAINT "work_review_chain_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_number_alias" ADD CONSTRAINT "work_task_number_alias_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task_number_alias" ADD CONSTRAINT "work_task_number_alias_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_triage_rule" ADD CONSTRAINT "work_triage_rule_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_triage_rule" ADD CONSTRAINT "work_triage_rule_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_acceptance" ADD CONSTRAINT "project_acceptance_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_acceptance" ADD CONSTRAINT "project_acceptance_milestone_id_project_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_acceptance" ADD CONSTRAINT "project_acceptance_retainer_period_id_project_retainer_period_id_fk" FOREIGN KEY ("retainer_period_id") REFERENCES "public"."project_retainer_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_acceptance" ADD CONSTRAINT "project_acceptance_generated_file_id_stored_file_id_fk" FOREIGN KEY ("generated_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_acceptance" ADD CONSTRAINT "project_acceptance_signed_file_id_stored_file_id_fk" FOREIGN KEY ("signed_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_acceptance" ADD CONSTRAINT "project_acceptance_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_acceptance_id_project_acceptance_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."project_acceptance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_milestone_id_project_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_retainer_period_id_project_retainer_period_id_fk" FOREIGN KEY ("retainer_period_id") REFERENCES "public"."project_retainer_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD CONSTRAINT "project_billing_item_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_booking" ADD CONSTRAINT "project_booking_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_booking" ADD CONSTRAINT "project_booking_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_booking" ADD CONSTRAINT "project_booking_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_request" ADD CONSTRAINT "project_change_request_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_request" ADD CONSTRAINT "project_change_request_evidence_file_id_stored_file_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_change_request" ADD CONSTRAINT "project_change_request_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_report" ADD CONSTRAINT "project_client_report_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_report" ADD CONSTRAINT "project_client_report_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_report" ADD CONSTRAINT "project_client_report_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deliverable" ADD CONSTRAINT "project_deliverable_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deliverable" ADD CONSTRAINT "project_deliverable_retainer_period_id_project_retainer_period_id_fk" FOREIGN KEY ("retainer_period_id") REFERENCES "public"."project_retainer_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deliverable" ADD CONSTRAINT "project_deliverable_milestone_id_project_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting" ADD CONSTRAINT "project_meeting_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting" ADD CONSTRAINT "project_meeting_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_task" ADD CONSTRAINT "project_meeting_task_meeting_id_project_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."project_meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_meeting_task" ADD CONSTRAINT "project_meeting_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_phase_id_project_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phase"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_done_by_person_id_person_id_fk" FOREIGN KEY ("done_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phase" ADD CONSTRAINT "project_phase_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plan" ADD CONSTRAINT "project_plan_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plan" ADD CONSTRAINT "project_plan_account_manager_person_id_person_id_fk" FOREIGN KEY ("account_manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_plan" ADD CONSTRAINT "project_plan_closed_by_person_id_person_id_fk" FOREIGN KEY ("closed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_item" ADD CONSTRAINT "project_raid_item_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_item" ADD CONSTRAINT "project_raid_item_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_item" ADD CONSTRAINT "project_raid_item_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_item" ADD CONSTRAINT "project_raid_item_evidence_file_id_stored_file_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_raid_item" ADD CONSTRAINT "project_raid_item_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_retainer" ADD CONSTRAINT "project_retainer_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_retainer" ADD CONSTRAINT "project_retainer_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_retainer_period" ADD CONSTRAINT "project_retainer_period_retainer_id_project_retainer_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."project_retainer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_update" ADD CONSTRAINT "project_status_update_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status_update" ADD CONSTRAINT "project_status_update_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_link" ADD CONSTRAINT "project_task_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_link" ADD CONSTRAINT "project_task_link_milestone_id_project_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_link" ADD CONSTRAINT "project_task_link_deliverable_id_project_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."project_deliverable"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task_link" ADD CONSTRAINT "project_task_link_phase_id_project_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phase"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan" ADD CONSTRAINT "daily_plan_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reminder_sent" ADD CONSTRAINT "daily_reminder_sent_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_comment" ADD CONSTRAINT "daily_report_comment_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_comment" ADD CONSTRAINT "daily_report_comment_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_team_policy" ADD CONSTRAINT "daily_team_policy_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_weekly_report" ADD CONSTRAINT "daily_weekly_report_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_week" ADD CONSTRAINT "timesheet_week_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_week" ADD CONSTRAINT "timesheet_week_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_automation_team_idx" ON "work_automation" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "work_automation_run_idx" ON "work_automation_run" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "work_blocker_task_idx" ON "work_blocker" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_blocker_open_unique" ON "work_blocker" USING btree ("task_id") WHERE "work_blocker"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "work_blocker_needed_idx" ON "work_blocker" USING btree ("needed_person_id") WHERE "work_blocker"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "work_cover_item_cover_idx" ON "work_cover_item" USING btree ("cover_person_id");--> statement-breakpoint
CREATE INDEX "work_cover_plan_person_idx" ON "work_cover_plan" USING btree ("person_id","from_date");--> statement-breakpoint
CREATE INDEX "work_custom_field_team_idx" ON "work_custom_field" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "work_custom_field_project_idx" ON "work_custom_field" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_cycle_dates_idx" ON "work_cycle" USING btree ("team_id","start_date");--> statement-breakpoint
CREATE INDEX "work_deliverable_decision_idx" ON "work_deliverable_decision" USING btree ("deliverable_id","created_at");--> statement-breakpoint
CREATE INDEX "work_deliverable_pin_idx" ON "work_deliverable_pin" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "work_delivery_task_idx" ON "work_delivery" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "work_exit_handover_person_idx" ON "work_exit_handover" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "work_handoff_task_idx" ON "work_handoff" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "work_handoff_to_idx" ON "work_handoff" USING btree ("to_person_id") WHERE "work_handoff"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "work_handoff_team_idx" ON "work_handoff" USING btree ("to_team_id") WHERE "work_handoff"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "work_handoff_package_team_idx" ON "work_handoff_package" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "work_publish_task_idx" ON "work_publish" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "work_publish_planned_idx" ON "work_publish" USING btree ("planned_at") WHERE "work_publish"."status" = 'planned';--> statement-breakpoint
CREATE INDEX "work_publish_result_idx" ON "work_publish_result" USING btree ("publish_id","recorded_on");--> statement-breakpoint
CREATE INDEX "work_review_chain_team_idx" ON "work_review_chain" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "work_review_chain_project_idx" ON "work_review_chain" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_task_number_alias_task_idx" ON "work_task_number_alias" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "work_triage_rule_team_idx" ON "work_triage_rule" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "project_billing_item_entity_idx" ON "project_billing_item" USING btree ("entity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_billing_item_acceptance_unique" ON "project_billing_item" USING btree ("acceptance_id") WHERE "project_billing_item"."acceptance_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_billing_item_milestone_unique" ON "project_billing_item" USING btree ("milestone_id") WHERE "project_billing_item"."milestone_id" IS NOT NULL AND "project_billing_item"."source" = 'milestone';--> statement-breakpoint
CREATE INDEX "project_booking_person_idx" ON "project_booking" USING btree ("person_id","week_start");--> statement-breakpoint
CREATE INDEX "project_booking_project_idx" ON "project_booking" USING btree ("project_id","week_start");--> statement-breakpoint
CREATE INDEX "project_client_report_idx" ON "project_client_report" USING btree ("project_id","period_to");--> statement-breakpoint
CREATE INDEX "project_deliverable_project_idx" ON "project_deliverable" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_deliverable_period_idx" ON "project_deliverable" USING btree ("retainer_period_id");--> statement-breakpoint
CREATE INDEX "project_meeting_idx" ON "project_meeting" USING btree ("project_id","held_on");--> statement-breakpoint
CREATE INDEX "project_milestone_project_idx" ON "project_milestone" USING btree ("project_id","due_date");--> statement-breakpoint
CREATE INDEX "project_phase_project_idx" ON "project_phase" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_plan_am_idx" ON "project_plan" USING btree ("account_manager_person_id");--> statement-breakpoint
CREATE INDEX "project_raid_item_idx" ON "project_raid_item" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "project_status_update_idx" ON "project_status_update" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_task_link_milestone_idx" ON "project_task_link" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "project_task_link_deliverable_idx" ON "project_task_link" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "daily_report_date_idx" ON "daily_report" USING btree ("date");--> statement-breakpoint
CREATE INDEX "daily_report_comment_idx" ON "daily_report_comment" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "time_entry_person_idx" ON "time_entry" USING btree ("person_id","date");--> statement-breakpoint
CREATE INDEX "time_entry_project_idx" ON "time_entry" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "time_entry_task_idx" ON "time_entry" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entry_timer_idx" ON "time_entry" USING btree ("person_id") WHERE "time_entry"."timer_started_at" IS NOT NULL AND "time_entry"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "timesheet_week_status_idx" ON "timesheet_week" USING btree ("status","week_start");--> statement-breakpoint
ALTER TABLE "work_client" ADD CONSTRAINT "work_client_account_manager_person_id_person_id_fk" FOREIGN KEY ("account_manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_triage_decided_by_person_id_person_id_fk" FOREIGN KEY ("triage_decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_task_triage_idx" ON "work_task" USING btree ("team_id") WHERE "work_task"."triage_status" IN ('pending', 'snoozed');--> statement-breakpoint
CREATE INDEX "work_task_cycle_idx" ON "work_task" USING btree ("cycle_id");