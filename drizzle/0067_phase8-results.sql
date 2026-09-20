CREATE TABLE "kpi_score_use" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_type" text NOT NULL,
	"consumer_id" uuid NOT NULL,
	"score_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_score_use_unique" UNIQUE("consumer_id","score_id")
);
--> statement-breakpoint
ALTER TABLE "kpi_score_use" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "performance_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"year" integer NOT NULL,
	"weighting_version_id" uuid,
	"participant_id" uuid,
	"review_score_bp" integer,
	"kpi_score_bp" integer,
	"okr_score_bp" integer,
	"computed_score_bp" integer,
	"computed_band" text,
	"override_score_bp" integer,
	"override_reason" text,
	"override_by_person_id" uuid,
	"override_at" timestamp with time zone,
	"final_score_bp" integer,
	"final_band" text,
	"multiplier_bp" integer,
	"trace" jsonb NOT NULL,
	"kpi_score_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_person_id" uuid,
	"published_at" timestamp with time zone,
	"published_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_result_unique" UNIQUE("person_id","year")
);
--> statement-breakpoint
ALTER TABLE "performance_result" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "performance_weighting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"value" jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" text DEFAULT 'proposed' NOT NULL,
	"note" text,
	"proposed_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_weighting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kpi_score_use" ADD CONSTRAINT "kpi_score_use_score_id_kpi_score_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."kpi_score"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_score_use" ADD CONSTRAINT "kpi_score_use_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_score_use" ADD CONSTRAINT "kpi_score_use_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_result" ADD CONSTRAINT "performance_result_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_result" ADD CONSTRAINT "performance_result_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_result" ADD CONSTRAINT "performance_result_weighting_version_id_performance_weighting_id_fk" FOREIGN KEY ("weighting_version_id") REFERENCES "public"."performance_weighting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_result" ADD CONSTRAINT "performance_result_participant_id_review_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."review_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_result" ADD CONSTRAINT "performance_result_override_by_person_id_person_id_fk" FOREIGN KEY ("override_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_result" ADD CONSTRAINT "performance_result_locked_by_person_id_person_id_fk" FOREIGN KEY ("locked_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_result" ADD CONSTRAINT "performance_result_published_by_person_id_person_id_fk" FOREIGN KEY ("published_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_weighting" ADD CONSTRAINT "performance_weighting_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_weighting" ADD CONSTRAINT "performance_weighting_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_weighting" ADD CONSTRAINT "performance_weighting_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpi_score_use_month_idx" ON "kpi_score_use" USING btree ("entity_id","month");--> statement-breakpoint
CREATE INDEX "kpi_score_use_year_idx" ON "kpi_score_use" USING btree ("entity_id","year");--> statement-breakpoint
CREATE INDEX "performance_result_year_idx" ON "performance_result" USING btree ("year","entity_id","status");--> statement-breakpoint
CREATE INDEX "performance_weighting_entity_idx" ON "performance_weighting" USING btree ("entity_id","status","valid_from");