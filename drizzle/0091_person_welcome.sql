ALTER TABLE "person" ADD COLUMN "welcome_completed_at" timestamp with time zone;--> statement-breakpoint
-- The guide is for a first sign-in: whoever has already signed in is past it.
UPDATE "person" SET "welcome_completed_at" = now() WHERE "welcome_completed_at" IS NULL AND EXISTS (SELECT 1 FROM "user" u WHERE lower(u."email") = "person"."work_email");
