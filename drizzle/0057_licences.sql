CREATE TABLE "licence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vendor" text,
	"entity_id" uuid NOT NULL,
	"seats" integer,
	"seat_holder_person_ids" uuid[],
	"cost_per_cycle" bigint,
	"billing_cycle" text NOT NULL,
	"renewal_date" date,
	"auto_renews" boolean DEFAULT true NOT NULL,
	"owner_person_id" uuid,
	"asset_id" uuid,
	"account_ref" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "licence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "licence" ADD CONSTRAINT "licence_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence" ADD CONSTRAINT "licence_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence" ADD CONSTRAINT "licence_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licence" ADD CONSTRAINT "licence_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "licence_entity_idx" ON "licence" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "licence_renewal_idx" ON "licence" USING btree ("renewal_date");