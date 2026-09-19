CREATE TABLE "obligation_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"nominal_due_date" date NOT NULL,
	"source_type" text,
	"source_id" text,
	"reviewer_person_id" uuid,
	"checklist_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reference_number" text,
	"submitted_date" date,
	"amount_paid" bigint,
	"note" text,
	"completed_late" boolean,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligation_instance_task_id_unique" UNIQUE("task_id"),
	CONSTRAINT "obligation_instance_period_key" UNIQUE("template_id","entity_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "obligation_instance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "obligation_notice_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligation_notice_sent_key" UNIQUE("instance_id","key")
);
--> statement-breakpoint
ALTER TABLE "obligation_notice_sent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "obligation_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"authority" text NOT NULL,
	"recurrence" text NOT NULL,
	"due_rule" jsonb NOT NULL,
	"shift" text DEFAULT 'next_working_day' NOT NULL,
	"event_type" text,
	"entity_ids" jsonb,
	"owner_rule" text NOT NULL,
	"owner_person_id" uuid,
	"reviewer_rule" text DEFAULT 'none' NOT NULL,
	"reviewer_person_id" uuid,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guidance" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reminder_lead_days" jsonb DEFAULT '[7,3,1]'::jsonb NOT NULL,
	"escalation" jsonb DEFAULT '{"managerAfterDays":3,"executiveAfterDays":7}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{"file":false,"reference":false,"submittedDate":false,"amount":false}'::jsonb NOT NULL,
	"penalty_note" text,
	"review_status" text DEFAULT 'unreviewed' NOT NULL,
	"reviewed_by_person_id" uuid,
	"reviewed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligation_template_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "obligation_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "obligation_instance" ADD CONSTRAINT "obligation_instance_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_instance" ADD CONSTRAINT "obligation_instance_template_id_obligation_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."obligation_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_instance" ADD CONSTRAINT "obligation_instance_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_instance" ADD CONSTRAINT "obligation_instance_reviewer_person_id_person_id_fk" FOREIGN KEY ("reviewer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_notice_sent" ADD CONSTRAINT "obligation_notice_sent_instance_id_obligation_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."obligation_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_template" ADD CONSTRAINT "obligation_template_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_template" ADD CONSTRAINT "obligation_template_reviewer_person_id_person_id_fk" FOREIGN KEY ("reviewer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_template" ADD CONSTRAINT "obligation_template_reviewed_by_person_id_person_id_fk" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "obligation_instance_entity_idx" ON "obligation_instance" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "obligation_instance_source_idx" ON "obligation_instance" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "obligation_template_recurrence_idx" ON "obligation_template" USING btree ("recurrence");