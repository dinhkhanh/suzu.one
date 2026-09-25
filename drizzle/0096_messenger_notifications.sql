CREATE TYPE "public"."messenger_status" AS ENUM('pending', 'sent', 'simulated', 'failed', 'dropped');--> statement-breakpoint
CREATE TABLE "messenger_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"status" "messenger_status" DEFAULT 'pending' NOT NULL,
	"via" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messenger_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messenger_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"psid" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "messenger_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messenger_link_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"psid" text,
	"code_hash" text,
	"code_sent_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "messenger_link_request_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "messenger_link_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messenger_delivery" ADD CONSTRAINT "messenger_delivery_link_id_messenger_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."messenger_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_delivery" ADD CONSTRAINT "messenger_delivery_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_link" ADD CONSTRAINT "messenger_link_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_link_request" ADD CONSTRAINT "messenger_link_request_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messenger_delivery_status_idx" ON "messenger_delivery" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "messenger_delivery_person_idx" ON "messenger_delivery" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_link_live_person_idx" ON "messenger_link" USING btree ("person_id") WHERE "messenger_link"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_link_live_psid_idx" ON "messenger_link" USING btree ("psid") WHERE "messenger_link"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "messenger_link_request_person_idx" ON "messenger_link_request" USING btree ("person_id","created_at");