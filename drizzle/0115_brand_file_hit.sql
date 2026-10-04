CREATE TABLE "brand_file_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_file_hit_key" UNIQUE("bucket","key_hash","window_start")
);
--> statement-breakpoint
ALTER TABLE "brand_file_hit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "brand_file_hit_window_idx" ON "brand_file_hit" USING btree ("window_start");