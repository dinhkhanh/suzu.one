CREATE TYPE "public"."approval_assignee_status" AS ENUM('pending', 'approved', 'rejected', 'returned');--> statement-breakpoint
CREATE TYPE "public"."approval_event_type" AS ENUM('submitted', 'approved', 'rejected', 'returned', 'resubmitted', 'commented', 'withdrawn', 'delegated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'rejected', 'returned', 'withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_step_mode" AS ENUM('any', 'all');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('waiting', 'pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TABLE "approval_assignee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"approver_person_id" uuid NOT NULL,
	"delegated_from_person_id" uuid,
	"status" "approval_assignee_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approval_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"type" "approval_event_type" NOT NULL,
	"actor_person_id" uuid,
	"step_index" smallint,
	"comment" text,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"entity_id" uuid,
	"requester_person_id" uuid NOT NULL,
	"subject_person_id" uuid,
	"subject_type" text,
	"subject_id" text,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_enc" text,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"current_step" smallint DEFAULT 0 NOT NULL,
	"flow_snapshot" jsonb NOT NULL,
	"link" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approval_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_index" smallint NOT NULL,
	"key" text NOT NULL,
	"mode" "approval_step_mode" NOT NULL,
	"status" "approval_step_status" NOT NULL,
	CONSTRAINT "approval_step_request_index_key" UNIQUE("request_id","step_index")
);
--> statement-breakpoint
ALTER TABLE "approval_step" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_assignee" ADD CONSTRAINT "approval_assignee_step_id_approval_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignee" ADD CONSTRAINT "approval_assignee_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignee" ADD CONSTRAINT "approval_assignee_approver_person_id_person_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assignee" ADD CONSTRAINT "approval_assignee_delegated_from_person_id_person_id_fk" FOREIGN KEY ("delegated_from_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requester_person_id_person_id_fk" FOREIGN KEY ("requester_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_subject_person_id_person_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_assignee_inbox_idx" ON "approval_assignee" USING btree ("approver_person_id","status");--> statement-breakpoint
CREATE INDEX "approval_assignee_request_idx" ON "approval_assignee" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "approval_event_request_idx" ON "approval_event" USING btree ("request_id","id");--> statement-breakpoint
CREATE INDEX "approval_request_requester_idx" ON "approval_request" USING btree ("requester_person_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_request_subject_idx" ON "approval_request" USING btree ("subject_person_id","type");--> statement-breakpoint
CREATE INDEX "approval_request_status_idx" ON "approval_request" USING btree ("status");