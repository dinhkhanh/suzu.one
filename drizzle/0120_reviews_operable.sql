CREATE TABLE "performance_reminder_sent" (
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"sent_on" date NOT NULL,
	CONSTRAINT "performance_reminder_sent_person_id_kind_subject_pk" PRIMARY KEY("person_id","kind","subject")
);
--> statement-breakpoint
ALTER TABLE "performance_reminder_sent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD COLUMN "sign_off_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD COLUMN "is_rolling" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_form" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_form" ADD COLUMN "returned_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "review_form" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "self_due_on" date;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "manager_due_on" date;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "sign_off_on" date;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "sign_off_note" text;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "sign_off_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "sign_off_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "removed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "review_participant" ADD COLUMN "removal_reason" text;--> statement-breakpoint
ALTER TABLE "review_template" ADD COLUMN "kinds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "review_template" ADD COLUMN "seed_key" text;--> statement-breakpoint
ALTER TABLE "performance_reminder_sent" ADD CONSTRAINT "performance_reminder_sent_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_form" ADD CONSTRAINT "review_form_returned_by_person_id_person_id_fk" FOREIGN KEY ("returned_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_sign_off_by_person_id_person_id_fk" FOREIGN KEY ("sign_off_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_removed_by_person_id_person_id_fk" FOREIGN KEY ("removed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_template" ADD CONSTRAINT "review_template_seed_key_unique" UNIQUE("seed_key");