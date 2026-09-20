CREATE TYPE "public"."work_location_mode" AS ENUM('flag', 'block');--> statement-breakpoint
CREATE TYPE "public"."work_location_rule" AS ENUM('gps_or_ip', 'gps', 'ip', 'gps_and_ip');--> statement-breakpoint
CREATE TYPE "public"."punch_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."punch_review" AS ENUM('none', 'pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."punch_source" AS ENUM('app', 'device', 'manual', 'request');--> statement-breakpoint
CREATE TABLE "punch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"direction" "punch_direction" NOT NULL,
	"source" "punch_source" NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_m" integer,
	"ip_address" text,
	"user_agent" text,
	"device_info" jsonb,
	"location_id" uuid,
	"distance_m" integer,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "punch_review" DEFAULT 'none' NOT NULL,
	"reviewed_by_person_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "punch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"latitude" double precision,
	"longitude" double precision,
	"radius_m" integer,
	"accuracy_limit_m" integer DEFAULT 100 NOT NULL,
	"ip_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rule" "work_location_rule" DEFAULT 'gps_or_ip' NOT NULL,
	"mode" "work_location_mode" DEFAULT 'flag' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "punch" ADD CONSTRAINT "punch_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch" ADD CONSTRAINT "punch_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch" ADD CONSTRAINT "punch_location_id_work_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch" ADD CONSTRAINT "punch_reviewed_by_person_id_person_id_fk" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_location" ADD CONSTRAINT "work_location_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "punch_person_at_idx" ON "punch" USING btree ("person_id","at");--> statement-breakpoint
CREATE INDEX "punch_entity_at_idx" ON "punch" USING btree ("entity_id","at");--> statement-breakpoint
CREATE INDEX "punch_review_idx" ON "punch" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "work_location_entity_idx" ON "work_location" USING btree ("entity_id");