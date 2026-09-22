ALTER TABLE "kpi_actual" ADD COLUMN "status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "kpi_actual" ADD COLUMN "proposed_value" bigint;