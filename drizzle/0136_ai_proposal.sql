SET lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."ai_proposal_status" AS ENUM('pending', 'confirming', 'confirmed', 'discarded', 'failed');--> statement-breakpoint
CREATE TABLE "ai_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"action" text NOT NULL,
	"input" jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edit_href" text,
	"status" "ai_proposal_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_proposal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_message_id_ai_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_proposal_person_idx" ON "ai_proposal" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_proposal_turn_idx" ON "ai_proposal" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "ai_proposal_conversation_idx" ON "ai_proposal" USING btree ("conversation_id");