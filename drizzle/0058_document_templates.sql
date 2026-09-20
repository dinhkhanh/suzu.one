CREATE TABLE "document_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"entity_id" uuid,
	"kind" text NOT NULL,
	"tier" text NOT NULL,
	"body" text NOT NULL,
	"letterhead" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_template_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "document_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "generated_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"template_code" text NOT NULL,
	"template_version" integer NOT NULL,
	"kind" text NOT NULL,
	"tier" text NOT NULL,
	"subject_person_id" uuid NOT NULL,
	"entity_id" uuid,
	"number" text NOT NULL,
	"generated_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_document_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "generated_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_updated_by_person_id_person_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_document" ADD CONSTRAINT "generated_document_template_id_document_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_document" ADD CONSTRAINT "generated_document_subject_person_id_person_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_document" ADD CONSTRAINT "generated_document_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_document" ADD CONSTRAINT "generated_document_generated_by_person_id_person_id_fk" FOREIGN KEY ("generated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_template_kind_idx" ON "document_template" USING btree ("kind","is_active");--> statement-breakpoint
CREATE INDEX "document_template_entity_idx" ON "document_template" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "generated_document_subject_idx" ON "generated_document" USING btree ("subject_person_id","created_at");--> statement-breakpoint
CREATE INDEX "generated_document_template_idx" ON "generated_document" USING btree ("template_id");