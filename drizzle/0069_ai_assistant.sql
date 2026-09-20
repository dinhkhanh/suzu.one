CREATE TYPE "public"."ai_answer_outcome" AS ENUM('answered', 'unanswered', 'refused');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "ai_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"locale" text DEFAULT 'vi' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"body" text NOT NULL,
	"outcome" "ai_answer_outcome",
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"driver" text,
	"model" text,
	"score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_unanswered_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"message_id" uuid,
	"question" text NOT NULL,
	"locale" text DEFAULT 'vi' NOT NULL,
	"best_score" real,
	"resolved_at" timestamp with time zone,
	"resolved_by_person_id" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_unanswered_question" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_unanswered_question" ADD CONSTRAINT "ai_unanswered_question_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_unanswered_question" ADD CONSTRAINT "ai_unanswered_question_message_id_ai_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_unanswered_question" ADD CONSTRAINT "ai_unanswered_question_resolved_by_person_id_person_id_fk" FOREIGN KEY ("resolved_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_person_idx" ON "ai_conversation" USING btree ("person_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_message_conversation_idx" ON "ai_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_message_person_idx" ON "ai_message" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_unanswered_open_idx" ON "ai_unanswered_question" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "ai_unanswered_person_idx" ON "ai_unanswered_question" USING btree ("person_id");