CREATE TABLE "kb_ack_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_ack_audience" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_ack_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"sent_on" date NOT NULL,
	"kind" text DEFAULT 'reminder' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_ack_reminder" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_acknowledgement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_page" ADD COLUMN "review_reminded_on" date;--> statement-breakpoint
ALTER TABLE "kb_page" ADD COLUMN "ack_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_page" ADD COLUMN "ack_version_id" uuid;--> statement-breakpoint
ALTER TABLE "kb_page" ADD COLUMN "ack_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kb_page" ADD COLUMN "ack_due_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_ack_audience" ADD CONSTRAINT "kb_ack_audience_page_id_kb_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_ack_reminder" ADD CONSTRAINT "kb_ack_reminder_page_id_kb_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_ack_reminder" ADD CONSTRAINT "kb_ack_reminder_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_acknowledgement" ADD CONSTRAINT "kb_acknowledgement_page_id_kb_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_page"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_acknowledgement" ADD CONSTRAINT "kb_acknowledgement_version_id_kb_page_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."kb_page_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_acknowledgement" ADD CONSTRAINT "kb_acknowledgement_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_ack_audience_page_subject_idx" ON "kb_ack_audience" USING btree ("page_id","subject_key");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_ack_reminder_day_idx" ON "kb_ack_reminder" USING btree ("page_id","version_id","person_id","sent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_acknowledgement_once_idx" ON "kb_acknowledgement" USING btree ("page_id","version_id","person_id");--> statement-breakpoint
CREATE INDEX "kb_acknowledgement_person_idx" ON "kb_acknowledgement" USING btree ("person_id");--> statement-breakpoint
-- A confirmation is evidence: it is never changed or taken back.
CREATE OR REPLACE FUNCTION kb_acknowledgement_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kb_acknowledgement is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER kb_acknowledgement_append_only
  BEFORE UPDATE OR DELETE ON "kb_acknowledgement"
  FOR EACH ROW EXECUTE FUNCTION kb_acknowledgement_reject_change();
