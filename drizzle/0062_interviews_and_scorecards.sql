CREATE TABLE "interview" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"stage_id" uuid,
	"kind" text NOT NULL,
	"round" smallint DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"mode" text DEFAULT 'onsite' NOT NULL,
	"location" text,
	"meeting_url" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes_for_candidate" text,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calendar_driver" text,
	"calendar_status" text,
	"calendar_event_id" text,
	"calendar_error" text,
	"scheduled_by_person_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview_interviewer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_interviewer_key" UNIQUE("interview_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "interview_interviewer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interview_scorecard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"interviewer_person_id" uuid NOT NULL,
	"ratings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommendation" text,
	"strengths" text,
	"concerns" text,
	"notes" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_scorecard_key" UNIQUE("interview_id","interviewer_person_id")
);
--> statement-breakpoint
ALTER TABLE "interview_scorecard" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_opening" ADD COLUMN "interview_kit" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "interview" ADD CONSTRAINT "interview_application_id_job_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview" ADD CONSTRAINT "interview_opening_id_job_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_opening"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview" ADD CONSTRAINT "interview_stage_id_recruit_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."recruit_pipeline_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview" ADD CONSTRAINT "interview_scheduled_by_person_id_person_id_fk" FOREIGN KEY ("scheduled_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_interviewer" ADD CONSTRAINT "interview_interviewer_interview_id_interview_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_interviewer" ADD CONSTRAINT "interview_interviewer_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecard" ADD CONSTRAINT "interview_scorecard_interview_id_interview_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecard" ADD CONSTRAINT "interview_scorecard_interviewer_person_id_person_id_fk" FOREIGN KEY ("interviewer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_application_idx" ON "interview" USING btree ("application_id","start_at");--> statement-breakpoint
CREATE INDEX "interview_opening_idx" ON "interview" USING btree ("opening_id","start_at");--> statement-breakpoint
CREATE INDEX "interview_start_idx" ON "interview" USING btree ("start_at","status");--> statement-breakpoint
CREATE INDEX "interview_interviewer_person_idx" ON "interview_interviewer" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "interview_scorecard_person_idx" ON "interview_scorecard" USING btree ("interviewer_person_id","submitted_at");