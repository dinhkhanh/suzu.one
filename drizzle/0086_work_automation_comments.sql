ALTER TABLE "work_comment" ALTER COLUMN "author_person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_comment" ADD COLUMN "automation_id" uuid;--> statement-breakpoint
ALTER TABLE "work_comment" ADD CONSTRAINT "work_comment_automation_id_work_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."work_automation"("id") ON DELETE set null ON UPDATE no action;