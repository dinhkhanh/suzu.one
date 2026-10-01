ALTER TABLE "attendance_device" ADD COLUMN "push_token_hash" text;--> statement-breakpoint
ALTER TABLE "attendance_device" ADD COLUMN "push_token_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_device" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_device_push_token_key" ON "attendance_device" USING btree ("push_token_hash") WHERE "attendance_device"."push_token_hash" is not null;