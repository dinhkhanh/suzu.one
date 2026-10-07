SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "ai_model_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"purpose" text NOT NULL,
	"tier" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_model_call" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_model_call" ADD CONSTRAINT "ai_model_call_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_model_call_time_idx" ON "ai_model_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_model_call_person_idx" ON "ai_model_call" USING btree ("person_id","created_at");