SET lock_timeout = '5s';--> statement-breakpoint
ALTER TYPE "public"."ai_answer_outcome" ADD VALUE 'off_topic';--> statement-breakpoint
ALTER TYPE "public"."ai_answer_outcome" ADD VALUE 'limited';--> statement-breakpoint
ALTER TABLE "ai_message" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint
ALTER TABLE "ai_model_call" ADD COLUMN "turn_id" uuid;