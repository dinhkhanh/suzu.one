ALTER TABLE "request_submission" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "request_submission" ADD COLUMN "paid_amount" bigint;--> statement-breakpoint
ALTER TABLE "request_submission" ADD COLUMN "paid_reference" text;--> statement-breakpoint
ALTER TABLE "request_submission" ADD COLUMN "paid_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "request_submission" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_submission" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "request_type" ADD COLUMN "payout" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_submission" ADD CONSTRAINT "request_submission_paid_by_person_id_person_id_fk" FOREIGN KEY ("paid_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_submission" ADD CONSTRAINT "request_submission_document_id_generated_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."generated_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- REQ-01: the seeded types finance pays. A type an administrator invented stays "none" until they choose.
UPDATE "request_type" SET "payout" = 'payment' WHERE "code" IN ('payment', 'purchase');--> statement-breakpoint
UPDATE "request_type" SET "payout" = 'advance' WHERE "code" = 'advance';
