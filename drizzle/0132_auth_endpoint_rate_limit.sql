SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "auth_endpoint_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_endpoint_hit_key" UNIQUE("bucket","key_hash","window_start")
);
--> statement-breakpoint
ALTER TABLE "auth_endpoint_hit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "auth_endpoint_hit_window_idx" ON "auth_endpoint_hit" USING btree ("window_start");