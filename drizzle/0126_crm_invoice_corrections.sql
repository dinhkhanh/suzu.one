ALTER TABLE "crm_invoice" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_invoice_item" DROP CONSTRAINT "crm_invoice_item_pkey";--> statement-breakpoint
ALTER TABLE "crm_invoice_item" ADD CONSTRAINT "crm_invoice_item_billing_item_id_invoice_id_pk" PRIMARY KEY("billing_item_id","invoice_id");--> statement-breakpoint
ALTER TABLE "crm_invoice" ADD COLUMN "voided_reason" text;--> statement-breakpoint
ALTER TABLE "crm_invoice" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_invoice" ADD COLUMN "voided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_invoice_item" ADD COLUMN "amount_vnd" bigint;--> statement-breakpoint
ALTER TABLE "crm_payment" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_payment" ADD COLUMN "reversed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_payment" ADD COLUMN "reversed_reason" text;--> statement-breakpoint
ALTER TABLE "crm_invoice" ADD CONSTRAINT "crm_invoice_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_payment" ADD CONSTRAINT "crm_payment_reversed_by_person_id_person_id_fk" FOREIGN KEY ("reversed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;