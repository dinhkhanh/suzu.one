CREATE TABLE "feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled_for_all" boolean DEFAULT false NOT NULL,
	"entity_ids" uuid[] DEFAULT '{}' NOT NULL,
	"department_ids" uuid[] DEFAULT '{}' NOT NULL,
	"person_ids" uuid[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_person_id" uuid
);
--> statement-breakpoint
ALTER TABLE "feature_flag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "feature_flag_updated_by_person_id_person_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;