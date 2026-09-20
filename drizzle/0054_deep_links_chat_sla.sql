CREATE TYPE "public"."chat_status" AS ENUM('pending', 'sent', 'simulated', 'failed');--> statement-breakpoint
CREATE TABLE "chat_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"action_link" text,
	"action_label" text,
	"space" text,
	"status" "chat_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approval_action_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"action" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_action_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "approval_action_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_assignee" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_assignee" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_delivery" ADD CONSTRAINT "chat_delivery_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_action_token" ADD CONSTRAINT "approval_action_token_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_action_token" ADD CONSTRAINT "approval_action_token_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_delivery_status_idx" ON "chat_delivery" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approval_action_token_request_idx" ON "approval_action_token" USING btree ("request_id","person_id");