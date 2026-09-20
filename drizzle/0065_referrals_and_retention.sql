CREATE TABLE "referral" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referred_by_person_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"note" text,
	"bonus_settled_at" timestamp with time zone,
	"bonus_settled_by_person_id" uuid,
	"bonus_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_application_key" UNIQUE("application_id")
);
--> statement-breakpoint
ALTER TABLE "referral" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_referred_by_person_id_person_id_fk" FOREIGN KEY ("referred_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_opening_id_job_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."job_opening"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_application_id_job_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_bonus_settled_by_person_id_person_id_fk" FOREIGN KEY ("bonus_settled_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_person_idx" ON "referral" USING btree ("referred_by_person_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_opening_idx" ON "referral" USING btree ("opening_id");