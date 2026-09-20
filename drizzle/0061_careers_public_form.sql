CREATE TABLE "recruit_email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"subject_en" text,
	"body_en" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruit_email_template_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "recruit_email_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recruit_public_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"visitor_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruit_public_hit_key" UNIQUE("bucket","visitor_hash","window_start")
);
--> statement-breakpoint
ALTER TABLE "recruit_public_hit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recruit_email_template" ADD CONSTRAINT "recruit_email_template_updated_by_person_id_person_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recruit_email_template_kind_idx" ON "recruit_email_template" USING btree ("kind","is_active");--> statement-breakpoint
CREATE INDEX "recruit_public_hit_window_idx" ON "recruit_public_hit" USING btree ("window_start");