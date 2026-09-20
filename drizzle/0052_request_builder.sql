CREATE TABLE "request_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"request_type_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attachment_file_ids" uuid[],
	"amount" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_submission_approval_key" UNIQUE("approval_request_id")
);
--> statement-breakpoint
ALTER TABLE "request_submission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_vi" text NOT NULL,
	"name_en" text NOT NULL,
	"description_vi" text,
	"description_en" text,
	"category" text DEFAULT 'other' NOT NULL,
	"entity_id" uuid,
	"form" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"icon" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sla_remind_after_days" smallint DEFAULT 0 NOT NULL,
	"sla_escalate_after_days" smallint DEFAULT 0 NOT NULL,
	"sla_escalate_to" jsonb,
	"updated_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "request_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "request_submission" ADD CONSTRAINT "request_submission_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_submission" ADD CONSTRAINT "request_submission_request_type_id_request_type_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_updated_by_person_id_person_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_submission_type_idx" ON "request_submission" USING btree ("request_type_id","created_at");--> statement-breakpoint
CREATE INDEX "request_type_active_idx" ON "request_type" USING btree ("active","sort_order");