SET lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."ai_feedback_verdict" AS ENUM('right', 'wrong');--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"verdict" "ai_feedback_verdict" NOT NULL,
	"note" text,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_feedback_message_key" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "ai_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_message_id_ai_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_feedback_created_idx" ON "ai_feedback" USING btree ("created_at");