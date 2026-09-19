CREATE TYPE "public"."kb_access_level" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."kb_page_status" AS ENUM('draft', 'in_review', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."kb_space_kind" AS ENUM('open', 'controlled');--> statement-breakpoint
CREATE TABLE "kb_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"page_id" uuid,
	"subject_key" text NOT NULL,
	"level" "kb_access_level" DEFAULT 'view' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"has_unpublished_changes" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "kb_page_status" DEFAULT 'draft' NOT NULL,
	"published_version_id" uuid,
	"published_title" text,
	"published_at" timestamp with time zone,
	"access_root_id" uuid,
	"owner_person_id" uuid,
	"review_by" date,
	"search_title" text DEFAULT '' NOT NULL,
	"search_body" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, "search_title"), 'A') || setweight(to_tsvector('simple'::regconfig, "search_body"), 'B')) STORED,
	"created_by_person_id" uuid,
	"updated_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "kb_page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_page_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"author_person_id" uuid,
	"change_note" text,
	"is_major" boolean DEFAULT false NOT NULL,
	"approval_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_page_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_page_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"viewed_on" date NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_page_view" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_space" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"entity_id" uuid,
	"kind" "kb_space_kind" DEFAULT 'open' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_space_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "kb_space" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_access" ADD CONSTRAINT "kb_access_space_id_kb_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."kb_space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_access" ADD CONSTRAINT "kb_access_page_id_kb_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page" ADD CONSTRAINT "kb_page_space_id_kb_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."kb_space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page" ADD CONSTRAINT "kb_page_parent_id_kb_page_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."kb_page"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page" ADD CONSTRAINT "kb_page_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page" ADD CONSTRAINT "kb_page_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page" ADD CONSTRAINT "kb_page_updated_by_person_id_person_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page_version" ADD CONSTRAINT "kb_page_version_page_id_kb_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_page"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page_version" ADD CONSTRAINT "kb_page_version_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page_view" ADD CONSTRAINT "kb_page_view_page_id_kb_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page_view" ADD CONSTRAINT "kb_page_view_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_space" ADD CONSTRAINT "kb_space_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_space" ADD CONSTRAINT "kb_space_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_access_space_subject_idx" ON "kb_access" USING btree ("space_id","subject_key") WHERE "kb_access"."page_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_access_page_subject_idx" ON "kb_access" USING btree ("page_id","subject_key") WHERE "kb_access"."page_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_access_subject_idx" ON "kb_access" USING btree ("subject_key");--> statement-breakpoint
CREATE INDEX "kb_page_space_parent_idx" ON "kb_page" USING btree ("space_id","parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "kb_page_access_root_idx" ON "kb_page" USING btree ("access_root_id");--> statement-breakpoint
CREATE INDEX "kb_page_published_at_idx" ON "kb_page" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "kb_page_search_idx" ON "kb_page" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_page_version_no_idx" ON "kb_page_version" USING btree ("page_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_page_view_day_idx" ON "kb_page_view" USING btree ("page_id","person_id","viewed_on");--> statement-breakpoint
CREATE INDEX "kb_page_view_person_idx" ON "kb_page_view" USING btree ("person_id","viewed_at");--> statement-breakpoint
CREATE INDEX "kb_space_entity_idx" ON "kb_space" USING btree ("entity_id");--> statement-breakpoint
-- Published versions are the record of what people read and acknowledged: append-only, like the audit log.
CREATE OR REPLACE FUNCTION kb_page_version_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kb_page_version is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kb_page_version_append_only
  BEFORE UPDATE OR DELETE ON "kb_page_version"
  FOR EACH ROW EXECUTE FUNCTION kb_page_version_reject_change();
