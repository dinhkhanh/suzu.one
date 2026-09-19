CREATE TYPE "public"."parameter_status" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "statutory_parameter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" "parameter_status" DEFAULT 'proposed' NOT NULL,
	"legal_reference" text,
	"note" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"proposed_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statutory_parameter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "statutory_parameter" ADD CONSTRAINT "statutory_parameter_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_parameter" ADD CONSTRAINT "statutory_parameter_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statutory_parameter_key_idx" ON "statutory_parameter" USING btree ("key","valid_from");