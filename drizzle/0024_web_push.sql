CREATE TYPE "public"."push_status" AS ENUM('pending', 'sent', 'simulated', 'failed', 'gone');--> statement-breakpoint
CREATE TABLE "push_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"status" "push_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "push_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "push" boolean;--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_subscription_id_push_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_delivery_status_idx" ON "push_delivery" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "push_delivery_person_idx" ON "push_delivery" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "push_subscription_person_idx" ON "push_subscription" USING btree ("person_id");