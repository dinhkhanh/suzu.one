CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"model" text,
	"serial" text,
	"entity_id" uuid NOT NULL,
	"purchase_date" date,
	"purchase_price" bigint,
	"supplier" text,
	"warranty_until" date,
	"condition" text DEFAULT 'good' NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"location" text,
	"notes" text,
	"photo_file_id" uuid,
	"qr_token" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_code_unique" UNIQUE("code"),
	CONSTRAINT "asset_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
ALTER TABLE "asset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "asset_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"holder_type" text NOT NULL,
	"holder_person_id" uuid,
	"holder_team_id" uuid,
	"holder_entity_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_person_id" uuid,
	"due_back" date,
	"purpose" text,
	"condition_out" text NOT NULL,
	"accessories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handover_confirmed_at" timestamp with time zone,
	"handover_note" text,
	"returned_at" timestamp with time zone,
	"returned_to_person_id" uuid,
	"condition_in" text,
	"return_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "asset_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"requires_serial" boolean DEFAULT false NOT NULL,
	"default_warranty_months" integer,
	"bookable" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_category_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "asset_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "asset_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "asset_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"asset_id" uuid NOT NULL,
	"assignment_id" uuid,
	"type" text NOT NULL,
	"actor_person_id" uuid,
	"note" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_category_id_asset_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_holder_person_id_person_id_fk" FOREIGN KEY ("holder_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_holder_team_id_team_id_fk" FOREIGN KEY ("holder_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_holder_entity_id_entity_id_fk" FOREIGN KEY ("holder_entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_assigned_by_person_id_person_id_fk" FOREIGN KEY ("assigned_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_returned_to_person_id_person_id_fk" FOREIGN KEY ("returned_to_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_assignment_id_asset_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."asset_assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_entity_idx" ON "asset" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "asset_category_idx" ON "asset" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "asset_serial_idx" ON "asset" USING btree ("serial");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_assignment_open_key" ON "asset_assignment" USING btree ("asset_id") WHERE "asset_assignment"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "asset_assignment_holder_idx" ON "asset_assignment" USING btree ("holder_person_id","returned_at");--> statement-breakpoint
CREATE INDEX "asset_assignment_asset_idx" ON "asset_assignment" USING btree ("asset_id","assigned_at");--> statement-breakpoint
CREATE INDEX "asset_category_kind_idx" ON "asset_category" USING btree ("kind","sort_order");--> statement-breakpoint
CREATE INDEX "asset_event_asset_idx" ON "asset_event" USING btree ("asset_id","id");