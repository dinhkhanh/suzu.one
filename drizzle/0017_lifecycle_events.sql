CREATE TYPE "public"."lifecycle_event_status" AS ENUM('pending', 'applied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_event_type" AS ENUM('hire', 'rehire', 'probation_pass', 'probation_fail', 'contract_renewal', 'transfer', 'promotion', 'salary_change', 'discipline', 'reward', 'long_leave', 'resignation', 'termination');--> statement-breakpoint
CREATE TABLE "lifecycle_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" "lifecycle_event_type" NOT NULL,
	"effective_date" date NOT NULL,
	"status" "lifecycle_event_status" DEFAULT 'applied' NOT NULL,
	"reason" text,
	"note" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_request_id" uuid,
	"assignment_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lifecycle_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_employment_id_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "public"."employment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_event" ADD CONSTRAINT "lifecycle_event_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lifecycle_event_person_idx" ON "lifecycle_event" USING btree ("person_id","effective_date");--> statement-breakpoint
CREATE INDEX "lifecycle_event_entity_type_idx" ON "lifecycle_event" USING btree ("entity_id","type","effective_date");