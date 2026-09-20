CREATE TYPE "public"."import_status" AS ENUM('invalid', 'ready', 'committed');--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"status" "import_status" NOT NULL,
	"row_count" integer NOT NULL,
	"rows" jsonb NOT NULL,
	"problems" jsonb NOT NULL,
	"result" jsonb,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "import_batch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batch_created_by_idx" ON "import_batch" USING btree ("created_by_person_id","created_at");