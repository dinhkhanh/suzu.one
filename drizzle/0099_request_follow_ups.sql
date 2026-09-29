ALTER TABLE "request_submission" ADD COLUMN "parent_submission_id" uuid;--> statement-breakpoint
ALTER TABLE "request_type" ADD COLUMN "follow_ups" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "request_type" ADD COLUMN "standalone" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "request_submission" ADD CONSTRAINT "request_submission_parent_submission_id_request_submission_id_fk" FOREIGN KEY ("parent_submission_id") REFERENCES "public"."request_submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_submission_parent_idx" ON "request_submission" USING btree ("parent_submission_id");--> statement-breakpoint
-- FR-REQ-05: the seeded business trip gets the follow-ups the seed now ships — an advance once the
-- trip is approved, and the payment that settles it from the trip's last day. Only where the trip
-- still has no follow-ups, its form still has `end_date`, and both child types exist; anything an
-- administrator has shaped differently is left alone. The catalogue is cached under a new key.
UPDATE "request_type" SET "follow_ups" = '[{"code":"advance","opensWhen":"approved","notBeforeField":null,"max":null},{"code":"payment","opensWhen":"approved","notBeforeField":"end_date","max":1}]'::jsonb, "updated_at" = now()
WHERE "code" = 'business_trip'
  AND "follow_ups" = '[]'::jsonb
  AND "form"->'fields' @> '[{"key":"end_date","type":"date"}]'::jsonb
  AND (SELECT count(*) FROM "request_type" c WHERE c."code" IN ('advance', 'payment')) = 2;
