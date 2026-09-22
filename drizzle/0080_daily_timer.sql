DROP INDEX "time_entry_timer_idx";--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "capped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entry_timer_idx" ON "time_entry" USING btree ("person_id") WHERE "time_entry"."timer_started_at" IS NOT NULL AND "time_entry"."deleted_at" IS NULL;