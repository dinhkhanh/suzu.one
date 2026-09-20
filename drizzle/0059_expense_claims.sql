CREATE TABLE "expense_claim_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"line_date" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"receipt_file_id" uuid,
	"project_tag" text,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_claim_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expense_claim_posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by_person_id" uuid,
	CONSTRAINT "expense_claim_posting_submission_key" UNIQUE("submission_id")
);
--> statement-breakpoint
ALTER TABLE "expense_claim_posting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_claim_line" ADD CONSTRAINT "expense_claim_line_submission_id_request_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."request_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claim_line" ADD CONSTRAINT "expense_claim_line_receipt_file_id_stored_file_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claim_posting" ADD CONSTRAINT "expense_claim_posting_submission_id_request_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."request_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claim_posting" ADD CONSTRAINT "expense_claim_posting_run_id_payroll_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claim_posting" ADD CONSTRAINT "expense_claim_posting_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claim_posting" ADD CONSTRAINT "expense_claim_posting_posted_by_person_id_person_id_fk" FOREIGN KEY ("posted_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_claim_line_submission_idx" ON "expense_claim_line" USING btree ("submission_id","sort_order");--> statement-breakpoint
CREATE INDEX "expense_claim_posting_run_idx" ON "expense_claim_posting" USING btree ("run_id","person_id");