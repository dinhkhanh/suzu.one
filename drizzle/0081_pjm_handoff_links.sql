ALTER TABLE "work_handoff" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_cover_plan" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "work_handoff" ADD CONSTRAINT "work_handoff_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_handoff_client_idx" ON "work_handoff" USING btree ("client_id") WHERE "work_handoff"."client_id" IS NOT NULL;