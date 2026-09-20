CREATE TABLE "asset_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"purpose" text,
	"project_ref" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"checked_out_at" timestamp with time zone,
	"checked_out_by_person_id" uuid,
	"condition_out" text,
	"checked_in_at" timestamp with time zone,
	"checked_in_by_person_id" uuid,
	"condition_in" text,
	"note" text,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_booking" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_booking" ADD CONSTRAINT "asset_booking_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking" ADD CONSTRAINT "asset_booking_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking" ADD CONSTRAINT "asset_booking_checked_out_by_person_id_person_id_fk" FOREIGN KEY ("checked_out_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking" ADD CONSTRAINT "asset_booking_checked_in_by_person_id_person_id_fk" FOREIGN KEY ("checked_in_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking" ADD CONSTRAINT "asset_booking_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking" ADD CONSTRAINT "asset_booking_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_booking_asset_idx" ON "asset_booking" USING btree ("asset_id","start_at");--> statement-breakpoint
CREATE INDEX "asset_booking_person_idx" ON "asset_booking" USING btree ("person_id","start_at");--> statement-breakpoint
CREATE INDEX "asset_booking_window_idx" ON "asset_booking" USING btree ("start_at","end_at");--> statement-breakpoint
-- Two bookings of one thing never overlap (FR-AST-03). Drizzle cannot express an exclusion
-- constraint, so it is hand-written here beside the others (0005, 0010, 0020); btree_gist was
-- installed by 0005. `tstzrange(..., '[)')` is half-open, so a booking ending at 17:00 and one
-- starting at 17:00 do not clash. Only the statuses that actually reserve the asset are covered
-- (`BOOKING_HOLDS_SLOT` in src/modules/assets/enums.ts): once gear is back on the shelf the rest
-- of its window is free again, and a late check-in is never refused by its own reservation.
ALTER TABLE "asset_booking" ADD CONSTRAINT "asset_booking_no_overlap"
  EXCLUDE USING gist ("asset_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("status" IN ('requested', 'confirmed', 'checked_out'));