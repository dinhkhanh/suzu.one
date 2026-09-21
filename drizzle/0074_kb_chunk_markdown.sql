ALTER TABLE "kb_page_chunk" ADD COLUMN "anchor" text;--> statement-breakpoint
ALTER TABLE "kb_page_chunk" ADD COLUMN "format" integer DEFAULT 1 NOT NULL;