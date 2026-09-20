CREATE TYPE "public"."parallel_finding_class" AS ENUM('system_bug', 'spreadsheet_error', 'rule_gap', 'accepted_rounding');--> statement-breakpoint
CREATE TABLE "payroll_parallel_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"month" text NOT NULL,
	"field" text NOT NULL,
	"delta_enc" text NOT NULL,
	"classification" "parallel_finding_class" NOT NULL,
	"note" text NOT NULL,
	"classified_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_parallel_finding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_parallel_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"month" text NOT NULL,
	"figures_enc" text NOT NULL,
	"note" text,
	"import_batch_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_parallel_reference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_ytd" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"months" integer DEFAULT 0 NOT NULL,
	"figures_enc" text NOT NULL,
	"note" text,
	"import_batch_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_ytd" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_parallel_finding" ADD CONSTRAINT "payroll_parallel_finding_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_parallel_finding" ADD CONSTRAINT "payroll_parallel_finding_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_parallel_finding" ADD CONSTRAINT "payroll_parallel_finding_classified_by_person_id_person_id_fk" FOREIGN KEY ("classified_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_parallel_reference" ADD CONSTRAINT "payroll_parallel_reference_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_parallel_reference" ADD CONSTRAINT "payroll_parallel_reference_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_parallel_reference" ADD CONSTRAINT "payroll_parallel_reference_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_ytd" ADD CONSTRAINT "payroll_ytd_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_ytd" ADD CONSTRAINT "payroll_ytd_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_ytd" ADD CONSTRAINT "payroll_ytd_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_parallel_finding_key" ON "payroll_parallel_finding" USING btree ("entity_id","month","person_id","field");--> statement-breakpoint
CREATE INDEX "payroll_parallel_finding_month_idx" ON "payroll_parallel_finding" USING btree ("entity_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_parallel_reference_key" ON "payroll_parallel_reference" USING btree ("entity_id","month","person_id");--> statement-breakpoint
CREATE INDEX "payroll_parallel_reference_person_idx" ON "payroll_parallel_reference" USING btree ("person_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_ytd_person_year_key" ON "payroll_ytd" USING btree ("person_id","year");--> statement-breakpoint
CREATE INDEX "payroll_ytd_entity_idx" ON "payroll_ytd" USING btree ("entity_id","year");