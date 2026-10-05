CREATE TABLE "ai_usage_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"person_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_hit_key" UNIQUE("bucket","person_id","window_start")
);
--> statement-breakpoint
ALTER TABLE "ai_usage_hit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_message" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_message" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_hit" ADD CONSTRAINT "ai_usage_hit_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_hit_window_idx" ON "ai_usage_hit" USING btree ("window_start");