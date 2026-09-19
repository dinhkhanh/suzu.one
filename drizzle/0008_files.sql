CREATE TYPE "public"."file_scan_status" AS ENUM('not_scanned', 'clean', 'infected');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready', 'rejected');--> statement-breakpoint
CREATE TABLE "stored_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"object_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"entity_id" uuid,
	"tier" text NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"scan_status" "file_scan_status" DEFAULT 'not_scanned' NOT NULL,
	"uploaded_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stored_file_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
ALTER TABLE "stored_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_uploaded_by_person_id_person_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_file_owner_idx" ON "stored_file" USING btree ("owner_type","owner_id");