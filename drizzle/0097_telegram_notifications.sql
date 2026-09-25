CREATE TYPE "public"."telegram_status" AS ENUM('pending', 'sent', 'simulated', 'failed', 'dropped');--> statement-breakpoint
CREATE TABLE "telegram_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"status" "telegram_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "telegram_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "telegram_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_link_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"chat_id" text,
	"code_hash" text,
	"code_sent_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "telegram_link_request_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "telegram_link_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_delivery" ADD CONSTRAINT "telegram_delivery_link_id_telegram_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."telegram_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_delivery" ADD CONSTRAINT "telegram_delivery_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link" ADD CONSTRAINT "telegram_link_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_request" ADD CONSTRAINT "telegram_link_request_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_delivery_status_idx" ON "telegram_delivery" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "telegram_delivery_person_idx" ON "telegram_delivery" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_live_person_idx" ON "telegram_link" USING btree ("person_id") WHERE "telegram_link"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_live_chat_idx" ON "telegram_link" USING btree ("chat_id") WHERE "telegram_link"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "telegram_link_request_person_idx" ON "telegram_link_request" USING btree ("person_id","created_at");