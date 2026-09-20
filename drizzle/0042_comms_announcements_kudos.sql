CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"kb_page_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"must_acknowledge" boolean DEFAULT false NOT NULL,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"author_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcement_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"subject_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_audience" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcement_read" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "announcement_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_vi" text NOT NULL,
	"name_en" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_value_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "company_value" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kudos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"value_key" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid
);
--> statement-breakpoint
ALTER TABLE "kudos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_audience" ADD CONSTRAINT "announcement_audience_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_read" ADD CONSTRAINT "announcement_read_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_read" ADD CONSTRAINT "announcement_read_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_from_person_id_person_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_to_person_id_person_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_deleted_by_person_id_person_id_fk" FOREIGN KEY ("deleted_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_status_publish_idx" ON "announcement" USING btree ("status","publish_at");--> statement-breakpoint
CREATE INDEX "announcement_author_idx" ON "announcement" USING btree ("author_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_audience_subject_idx" ON "announcement_audience" USING btree ("announcement_id","subject_key");--> statement-breakpoint
CREATE INDEX "announcement_audience_key_idx" ON "announcement_audience" USING btree ("subject_key");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_read_person_idx" ON "announcement_read" USING btree ("announcement_id","person_id");--> statement-breakpoint
CREATE INDEX "announcement_read_by_person_idx" ON "announcement_read" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "kudos_to_idx" ON "kudos" USING btree ("to_person_id","created_at");--> statement-breakpoint
CREATE INDEX "kudos_created_idx" ON "kudos" USING btree ("created_at");