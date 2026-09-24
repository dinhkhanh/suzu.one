CREATE TYPE "public"."feedback_category" AS ENUM('bug', 'idea', 'question', 'praise', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'in_progress', 'resolved', 'declined');--> statement-breakpoint
CREATE TABLE "app_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"category" "feedback_category" NOT NULL,
	"message" text NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"page_path" text,
	"area" text,
	"user_agent" text,
	"screenshot_file_id" uuid,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"priority" "feedback_priority" DEFAULT 'normal' NOT NULL,
	"reply" text,
	"replied_at" timestamp with time zone,
	"internal_note" text,
	"handled_by_person_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_handled_by_person_id_person_id_fk" FOREIGN KEY ("handled_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_feedback_person_idx" ON "app_feedback" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "app_feedback_status_idx" ON "app_feedback" USING btree ("status","created_at");