CREATE TABLE "brand_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"section_id" uuid,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_asset_file_id_unique" UNIQUE("file_id"),
	CONSTRAINT "brand_asset_kind_check" CHECK ("brand_asset"."kind" in ('logo', 'guideline', 'brochure', 'image', 'video', 'pack', 'other', 'example'))
);
--> statement-breakpoint
ALTER TABLE "brand_asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_asset_download" (
	"asset_id" uuid NOT NULL,
	"day" date NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "brand_asset_download_asset_id_day_pk" PRIMARY KEY("asset_id","day")
);
--> statement-breakpoint
ALTER TABLE "brand_asset_download" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_kit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"former_slugs" text[] DEFAULT '{}' NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"description" text,
	"description_en" text,
	"website_url" text,
	"contact_email" text,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fonts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'hidden' NOT NULL,
	"entity_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kit_slug_unique" UNIQUE("slug"),
	CONSTRAINT "brand_kit_visibility_check" CHECK ("brand_kit"."visibility" in ('hidden', 'unlisted', 'listed'))
);
--> statement-breakpoint
ALTER TABLE "brand_kit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"text" text NOT NULL,
	"text_en" text,
	"example_asset_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_rule_verdict_check" CHECK ("brand_rule"."verdict" in ('do', 'dont'))
);
--> statement-breakpoint
ALTER TABLE "brand_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brand_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text DEFAULT 'content' NOT NULL,
	"title" text NOT NULL,
	"title_en" text,
	"body" text,
	"body_en" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_section_kind_check" CHECK ("brand_section"."kind" in ('content', 'palette', 'typography', 'downloads'))
);
--> statement-breakpoint
ALTER TABLE "brand_section" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_asset" ADD CONSTRAINT "brand_asset_brand_id_brand_kit_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset" ADD CONSTRAINT "brand_asset_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset" ADD CONSTRAINT "brand_asset_section_id_brand_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."brand_section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset" ADD CONSTRAINT "brand_asset_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset_download" ADD CONSTRAINT "brand_asset_download_asset_id_brand_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."brand_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rule" ADD CONSTRAINT "brand_rule_section_id_brand_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."brand_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rule" ADD CONSTRAINT "brand_rule_example_asset_id_brand_asset_id_fk" FOREIGN KEY ("example_asset_id") REFERENCES "public"."brand_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_section" ADD CONSTRAINT "brand_section_brand_id_brand_kit_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_asset_brand_idx" ON "brand_asset" USING btree ("brand_id","sort_order");--> statement-breakpoint
CREATE INDEX "brand_rule_section_idx" ON "brand_rule" USING btree ("section_id","sort_order");--> statement-breakpoint
CREATE INDEX "brand_section_brand_idx" ON "brand_section" USING btree ("brand_id","sort_order");