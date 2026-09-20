ALTER TABLE "ai_message" ADD COLUMN "tool" text;--> statement-breakpoint
ALTER TABLE "ai_message" ADD COLUMN "tool_result" jsonb;