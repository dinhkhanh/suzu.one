CREATE TABLE "review_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"template_id" uuid,
	"form_snapshot" jsonb,
	"self_due_on" date,
	"manager_due_on" date,
	"peer_due_on" date,
	"calibration_on" date,
	"release_on" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"peers_enabled" boolean DEFAULT false NOT NULL,
	"peer_min" integer DEFAULT 0 NOT NULL,
	"peer_max" integer DEFAULT 5 NOT NULL,
	"peer_anonymous" boolean DEFAULT true NOT NULL,
	"launched_at" timestamp with time zone,
	"launched_by_person_id" uuid,
	"closed_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_cycle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"subject_person_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overall_rating_bp" integer,
	"score_trace" jsonb,
	"comment" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_form_unique" UNIQUE("participant_id","kind","author_person_id")
);
--> statement-breakpoint
ALTER TABLE "review_form" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"department_id" uuid,
	"manager_person_id" uuid,
	"stage" text DEFAULT 'pending' NOT NULL,
	"review_score_bp" integer,
	"calibration_note" text,
	"calibrated_at" timestamp with time zone,
	"calibrated_by_person_id" uuid,
	"released_at" timestamp with time zone,
	"released_by_person_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_participant_unique" UNIQUE("cycle_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "review_participant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_peer_nomination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"peer_person_id" uuid NOT NULL,
	"nominated_by_person_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_peer_nomination_unique" UNIQUE("participant_id","peer_person_id")
);
--> statement-breakpoint
ALTER TABLE "review_peer_nomination" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"description" text,
	"sections" jsonb NOT NULL,
	"rating_scale" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_template_id_review_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_launched_by_person_id_person_id_fk" FOREIGN KEY ("launched_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_form" ADD CONSTRAINT "review_form_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_form" ADD CONSTRAINT "review_form_participant_id_review_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."review_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_form" ADD CONSTRAINT "review_form_subject_person_id_person_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_form" ADD CONSTRAINT "review_form_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_manager_person_id_person_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_calibrated_by_person_id_person_id_fk" FOREIGN KEY ("calibrated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_released_by_person_id_person_id_fk" FOREIGN KEY ("released_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_peer_nomination" ADD CONSTRAINT "review_peer_nomination_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_peer_nomination" ADD CONSTRAINT "review_peer_nomination_participant_id_review_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."review_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_peer_nomination" ADD CONSTRAINT "review_peer_nomination_peer_person_id_person_id_fk" FOREIGN KEY ("peer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_peer_nomination" ADD CONSTRAINT "review_peer_nomination_nominated_by_person_id_person_id_fk" FOREIGN KEY ("nominated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_peer_nomination" ADD CONSTRAINT "review_peer_nomination_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_template" ADD CONSTRAINT "review_template_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_cycle_year_idx" ON "review_cycle" USING btree ("year","status");--> statement-breakpoint
CREATE INDEX "review_cycle_entity_idx" ON "review_cycle" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "review_form_author_idx" ON "review_form" USING btree ("author_person_id","status");--> statement-breakpoint
CREATE INDEX "review_form_participant_idx" ON "review_form" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "review_participant_person_idx" ON "review_participant" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "review_participant_manager_idx" ON "review_participant" USING btree ("manager_person_id");--> statement-breakpoint
CREATE INDEX "review_peer_nomination_peer_idx" ON "review_peer_nomination" USING btree ("peer_person_id","status");