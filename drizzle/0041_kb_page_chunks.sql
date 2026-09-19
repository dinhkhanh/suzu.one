CREATE TABLE "kb_page_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"embedding" real[],
	"embedding_model" text,
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_page_chunk" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_page_chunk" ADD CONSTRAINT "kb_page_chunk_page_id_kb_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_page_chunk_page_index_idx" ON "kb_page_chunk" USING btree ("page_id","chunk_index");--> statement-breakpoint
CREATE INDEX "kb_page_chunk_model_idx" ON "kb_page_chunk" USING btree ("embedding_model");