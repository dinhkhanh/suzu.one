ALTER TABLE "generated_document" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "generated_document" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "generated_document" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "generated_document" ADD CONSTRAINT "generated_document_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;