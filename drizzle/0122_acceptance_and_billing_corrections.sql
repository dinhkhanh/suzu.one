ALTER TABLE "project_acceptance" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "project_acceptance" ADD COLUMN "corrections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_billing_item" ADD COLUMN "corrections" jsonb DEFAULT '[]'::jsonb NOT NULL;