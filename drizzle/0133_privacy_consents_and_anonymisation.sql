SET lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."privacy_decision" AS ENUM('given', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."privacy_purpose" AS ENUM('gps_check_in', 'face_check_in');--> statement-breakpoint
CREATE TABLE "person_anonymisation" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"last_day" date NOT NULL,
	"anonymised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anonymised_by_person_id" uuid NOT NULL,
	"removed" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_anonymisation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "privacy_consent_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" "privacy_purpose" NOT NULL,
	"decision" "privacy_decision" NOT NULL,
	"notice_version" text,
	"notice_locale" text,
	"notice_text" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_consent_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person_anonymisation" ADD CONSTRAINT "person_anonymisation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_anonymisation" ADD CONSTRAINT "person_anonymisation_anonymised_by_person_id_person_id_fk" FOREIGN KEY ("anonymised_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_consent_event" ADD CONSTRAINT "privacy_consent_event_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_consent_event_person_idx" ON "privacy_consent_event" USING btree ("person_id","purpose","at");