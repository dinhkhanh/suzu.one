CREATE TABLE "recruit_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"token_hash" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"sent_by_person_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_file_id" uuid,
	"submission_links" text[] DEFAULT '{}' NOT NULL,
	"submission_note" text,
	"submitted_at" timestamp with time zone,
	"rating" smallint,
	"rating_note" text,
	"rated_by_person_id" uuid,
	"rated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruit_assignment_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "recruit_assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recruit_assignment" ADD CONSTRAINT "recruit_assignment_application_id_job_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_assignment" ADD CONSTRAINT "recruit_assignment_opening_id_job_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_opening"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_assignment" ADD CONSTRAINT "recruit_assignment_sent_by_person_id_person_id_fk" FOREIGN KEY ("sent_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruit_assignment" ADD CONSTRAINT "recruit_assignment_rated_by_person_id_person_id_fk" FOREIGN KEY ("rated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recruit_assignment_application_idx" ON "recruit_assignment" USING btree ("application_id","sent_at");--> statement-breakpoint
CREATE INDEX "recruit_assignment_opening_idx" ON "recruit_assignment" USING btree ("opening_id","status");