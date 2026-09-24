ALTER TABLE "session" ADD COLUMN "impersonate_person_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_at" timestamp with time zone;