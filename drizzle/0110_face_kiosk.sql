-- The face kiosk inside the app (FR-ATT-06): face templates with the consent behind them, and the
-- tablets opened as kiosks. New tables only, so the deployment still running reads nothing new.
CREATE TABLE "face_enrolment" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_recorded_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "face_enrolment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "face_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"model" text NOT NULL,
	"embedding" extensions.vector(128) NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "face_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kiosk_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"qr_secret" text NOT NULL,
	"opened_by_person_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"last_seen_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by_person_id" uuid
);
--> statement-breakpoint
ALTER TABLE "kiosk_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "face_enrolment" ADD CONSTRAINT "face_enrolment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_enrolment" ADD CONSTRAINT "face_enrolment_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_enrolment" ADD CONSTRAINT "face_enrolment_consent_recorded_by_person_id_person_id_fk" FOREIGN KEY ("consent_recorded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_template" ADD CONSTRAINT "face_template_person_id_face_enrolment_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."face_enrolment"("person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_template" ADD CONSTRAINT "face_template_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_template" ADD CONSTRAINT "face_template_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_session" ADD CONSTRAINT "kiosk_session_device_id_attendance_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_session" ADD CONSTRAINT "kiosk_session_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_session" ADD CONSTRAINT "kiosk_session_opened_by_person_id_person_id_fk" FOREIGN KEY ("opened_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_session" ADD CONSTRAINT "kiosk_session_closed_by_person_id_person_id_fk" FOREIGN KEY ("closed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "face_enrolment_entity_idx" ON "face_enrolment" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "face_template_person_idx" ON "face_template" USING btree ("person_id","model");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_session_token_key" ON "kiosk_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "kiosk_session_device_idx" ON "kiosk_session" USING btree ("device_id");