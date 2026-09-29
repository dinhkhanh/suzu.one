CREATE TABLE "crm_account" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text,
	"tax_code" text,
	"address" text,
	"website" text,
	"industry" text,
	"size" text,
	"source" text,
	"tier" text,
	"lifecycle" text DEFAULT 'prospect' NOT NULL,
	"lifecycle_manual" boolean DEFAULT false NOT NULL,
	"lifecycle_changed_at" timestamp with time zone,
	"contracting_entity_id" uuid,
	"sales_owner_person_id" uuid,
	"payment_terms_days" integer,
	"credit_hold" boolean DEFAULT false NOT NULL,
	"credit_hold_reason" text,
	"credit_limit_vnd" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_account_member" (
	"client_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_account_member_client_id_person_id_pk" PRIMARY KEY("client_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "crm_account_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"client_id" uuid,
	"contact_id" uuid,
	"deal_id" uuid,
	"lead_id" uuid,
	"owner_person_id" uuid NOT NULL,
	"due_on" date,
	"occurred_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"outcome" text,
	"reminded_on" date,
	"cover_from_person_id" uuid,
	"starts_at" timestamp with time zone,
	"duration_minutes" integer,
	"calendar_event_id" text,
	"calendar_driver" text,
	"calendar_status" text,
	"calendar_error" text,
	"meeting_url" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_commission_scheme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"name" text NOT NULL,
	"rule" jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_commission_scheme" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_commission_statement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"month" text NOT NULL,
	"scheme_id" uuid NOT NULL,
	"amount_enc" text NOT NULL,
	"trace_enc" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payroll_run_id" uuid,
	"confirmed_by_person_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_commission_statement_unique" UNIQUE("person_id","entity_id","month")
);
--> statement-breakpoint
ALTER TABLE "crm_commission_statement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_ids" uuid[] DEFAULT '{}' NOT NULL,
	"full_name" text NOT NULL,
	"search_name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"zalo" text,
	"decision_role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"preferred_channel" text,
	"birthday" date,
	"notes" text,
	"source" text NOT NULL,
	"lawful_basis" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"erased_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_contact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"entity_id" uuid,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"parent_contract_id" uuid,
	"deal_id" uuid,
	"start_date" date,
	"end_date" date,
	"value_vnd" bigint,
	"payment_terms_days" integer,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"notice_days" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"signed_on" date,
	"signed_file_id" uuid,
	"terminated_on" date,
	"note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_contract_number_unique" UNIQUE("entity_id","number")
);
--> statement-breakpoint
ALTER TABLE "crm_contract" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_contract_project" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_contract_project" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"entity_id" uuid,
	"client_id" uuid NOT NULL,
	"brand_id" uuid,
	"title" text NOT NULL,
	"service_lines" text[] DEFAULT '{}' NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"one_off_vnd" bigint,
	"monthly_vnd" bigint,
	"months" integer,
	"probability" integer,
	"expected_close_on" date,
	"owner_person_id" uuid NOT NULL,
	"team_id" uuid,
	"source" text,
	"lead_id" uuid,
	"competitors" text,
	"next_step" text,
	"lost_reason" text,
	"lost_note" text,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pitch_project_id" uuid,
	"renews_contract_id" uuid,
	"renews_project_id" uuid,
	"stale_notified_on" date,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_deal_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "crm_deal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_deal_contact" (
	"deal_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text,
	CONSTRAINT "crm_deal_contact_deal_id_contact_id_pk" PRIMARY KEY("deal_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "crm_deal_contact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_deal_project" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"handoff_note" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"handoff_status" text DEFAULT 'pending' NOT NULL,
	"handoff_to_person_id" uuid,
	"handoff_responded_at" timestamp with time zone,
	"handoff_return_reason" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_deal_project" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_deal_stage_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"changed_by_person_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_deal_stage_change" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"client_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"subtotal_vnd" bigint NOT NULL,
	"vat_vnd" bigint DEFAULT 0 NOT NULL,
	"total_vnd" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"written_off_reason" text,
	"note" text,
	"reminded" integer[] DEFAULT '{}' NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_invoice_number_unique" UNIQUE("entity_id","number")
);
--> statement-breakpoint
ALTER TABLE "crm_invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_invoice_item" (
	"billing_item_id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_invoice_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"client_id" uuid,
	"company_name" text NOT NULL,
	"contact_name" text,
	"contact_title" text,
	"email" text,
	"phone" text,
	"need" text,
	"budget_text" text,
	"source" text DEFAULT 'referral' NOT NULL,
	"referrer_person_id" uuid,
	"owner_person_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"disqualify_reason" text,
	"converted_deal_id" uuid,
	"converted_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_lead" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"method" text DEFAULT 'transfer' NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"number" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" date,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"subtotal_vnd" bigint DEFAULT 0 NOT NULL,
	"discount_vnd" bigint DEFAULT 0 NOT NULL,
	"vat_vnd" bigint DEFAULT 0 NOT NULL,
	"total_vnd" bigint DEFAULT 0 NOT NULL,
	"max_discount_bp" integer DEFAULT 0 NOT NULL,
	"intro" text,
	"terms" text,
	"approval_request_id" uuid,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_quote_version_unique" UNIQUE("number","version")
);
--> statement-breakpoint
ALTER TABLE "crm_quote" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_quote_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"service_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit" text,
	"unit_price_vnd" bigint DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"months" integer,
	"format" text,
	"channel" text,
	"role_minutes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_quote_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"category" text DEFAULT 'other' NOT NULL,
	"unit" text DEFAULT 'item' NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"format" text,
	"channel" text,
	"role_minutes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_service_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "crm_service" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_service_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"entity_id" uuid,
	"price_vnd" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_service_price" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crm_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"category" text NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"gates" text[] DEFAULT '{}' NOT NULL,
	"allows_pitch" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_stage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_account" ADD CONSTRAINT "crm_account_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_account" ADD CONSTRAINT "crm_account_contracting_entity_id_entity_id_fk" FOREIGN KEY ("contracting_entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_account" ADD CONSTRAINT "crm_account_sales_owner_person_id_person_id_fk" FOREIGN KEY ("sales_owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_account_member" ADD CONSTRAINT "crm_account_member_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_account_member" ADD CONSTRAINT "crm_account_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_account_member" ADD CONSTRAINT "crm_account_member_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_contact_id_crm_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_deal_id_crm_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_lead_id_crm_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_cover_from_person_id_person_id_fk" FOREIGN KEY ("cover_from_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_commission_scheme" ADD CONSTRAINT "crm_commission_scheme_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_commission_scheme" ADD CONSTRAINT "crm_commission_scheme_proposed_by_person_id_person_id_fk" FOREIGN KEY ("proposed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_commission_scheme" ADD CONSTRAINT "crm_commission_scheme_decided_by_person_id_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_commission_statement" ADD CONSTRAINT "crm_commission_statement_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_commission_statement" ADD CONSTRAINT "crm_commission_statement_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_commission_statement" ADD CONSTRAINT "crm_commission_statement_scheme_id_crm_commission_scheme_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."crm_commission_scheme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_commission_statement" ADD CONSTRAINT "crm_commission_statement_confirmed_by_person_id_person_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact" ADD CONSTRAINT "crm_contact_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact" ADD CONSTRAINT "crm_contact_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_deal_id_crm_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_signed_file_id_stored_file_id_fk" FOREIGN KEY ("signed_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contract" ADD CONSTRAINT "crm_contract_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contract_project" ADD CONSTRAINT "crm_contract_project_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contract_project" ADD CONSTRAINT "crm_contract_project_contract_id_crm_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."crm_contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_brand_id_work_client_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_stage_id_crm_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_lead_id_crm_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_pitch_project_id_work_project_id_fk" FOREIGN KEY ("pitch_project_id") REFERENCES "public"."work_project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_renews_project_id_work_project_id_fk" FOREIGN KEY ("renews_project_id") REFERENCES "public"."work_project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal" ADD CONSTRAINT "crm_deal_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_contact" ADD CONSTRAINT "crm_deal_contact_deal_id_crm_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_contact" ADD CONSTRAINT "crm_deal_contact_contact_id_crm_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_project" ADD CONSTRAINT "crm_deal_project_project_id_work_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."work_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_project" ADD CONSTRAINT "crm_deal_project_deal_id_crm_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_project" ADD CONSTRAINT "crm_deal_project_handoff_to_person_id_person_id_fk" FOREIGN KEY ("handoff_to_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_project" ADD CONSTRAINT "crm_deal_project_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_change" ADD CONSTRAINT "crm_deal_stage_change_deal_id_crm_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_change" ADD CONSTRAINT "crm_deal_stage_change_from_stage_id_crm_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."crm_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_change" ADD CONSTRAINT "crm_deal_stage_change_to_stage_id_crm_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."crm_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_change" ADD CONSTRAINT "crm_deal_stage_change_changed_by_person_id_person_id_fk" FOREIGN KEY ("changed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoice" ADD CONSTRAINT "crm_invoice_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoice" ADD CONSTRAINT "crm_invoice_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoice" ADD CONSTRAINT "crm_invoice_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoice_item" ADD CONSTRAINT "crm_invoice_item_billing_item_id_project_billing_item_id_fk" FOREIGN KEY ("billing_item_id") REFERENCES "public"."project_billing_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_invoice_item" ADD CONSTRAINT "crm_invoice_item_invoice_id_crm_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."crm_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead" ADD CONSTRAINT "crm_lead_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead" ADD CONSTRAINT "crm_lead_client_id_work_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."work_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead" ADD CONSTRAINT "crm_lead_referrer_person_id_person_id_fk" FOREIGN KEY ("referrer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead" ADD CONSTRAINT "crm_lead_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead" ADD CONSTRAINT "crm_lead_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_payment" ADD CONSTRAINT "crm_payment_invoice_id_crm_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."crm_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_payment" ADD CONSTRAINT "crm_payment_recorded_by_person_id_person_id_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quote" ADD CONSTRAINT "crm_quote_deal_id_crm_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."crm_deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quote" ADD CONSTRAINT "crm_quote_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quote_line" ADD CONSTRAINT "crm_quote_line_quote_id_crm_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."crm_quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_quote_line" ADD CONSTRAINT "crm_quote_line_service_id_crm_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."crm_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_service_price" ADD CONSTRAINT "crm_service_price_service_id_crm_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."crm_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_service_price" ADD CONSTRAINT "crm_service_price_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_service_price" ADD CONSTRAINT "crm_service_price_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_account_tax_idx" ON "crm_account" USING btree ("tax_code") WHERE "crm_account"."tax_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_account_sales_owner_idx" ON "crm_account" USING btree ("sales_owner_person_id");--> statement-breakpoint
CREATE INDEX "crm_account_member_person_idx" ON "crm_account_member" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "crm_activity_client_idx" ON "crm_activity" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activity_deal_idx" ON "crm_activity" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "crm_activity_lead_idx" ON "crm_activity" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "crm_activity_open_idx" ON "crm_activity" USING btree ("owner_person_id","due_on") WHERE "crm_activity"."done_at" IS NULL;--> statement-breakpoint
CREATE INDEX "crm_activity_done_idx" ON "crm_activity" USING btree ("owner_person_id","done_at");--> statement-breakpoint
CREATE INDEX "crm_contact_client_idx" ON "crm_contact" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "crm_contact_email_idx" ON "crm_contact" USING btree ("email") WHERE "crm_contact"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_contract_client_idx" ON "crm_contract" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "crm_contract_end_idx" ON "crm_contract" USING btree ("end_date") WHERE "crm_contract"."status" = 'signed';--> statement-breakpoint
CREATE INDEX "crm_contract_project_contract_idx" ON "crm_contract_project" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "crm_deal_client_idx" ON "crm_deal" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "crm_deal_owner_idx" ON "crm_deal" USING btree ("owner_person_id","status");--> statement-breakpoint
CREATE INDEX "crm_deal_entity_idx" ON "crm_deal" USING btree ("entity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_deal_renewal_unique" ON "crm_deal" USING btree ("renews_contract_id") WHERE "crm_deal"."renews_contract_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_deal_retainer_renewal_unique" ON "crm_deal" USING btree ("renews_project_id") WHERE "crm_deal"."renews_project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_deal_project_deal_idx" ON "crm_deal_project" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "crm_deal_project_handoff_idx" ON "crm_deal_project" USING btree ("handoff_to_person_id") WHERE "crm_deal_project"."handoff_status" = 'pending';--> statement-breakpoint
CREATE INDEX "crm_deal_stage_change_idx" ON "crm_deal_stage_change" USING btree ("deal_id","changed_at");--> statement-breakpoint
CREATE INDEX "crm_invoice_client_idx" ON "crm_invoice" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "crm_invoice_due_idx" ON "crm_invoice" USING btree ("due_on") WHERE "crm_invoice"."status" = 'open';--> statement-breakpoint
CREATE INDEX "crm_invoice_item_invoice_idx" ON "crm_invoice_item" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "crm_lead_owner_idx" ON "crm_lead" USING btree ("owner_person_id","status");--> statement-breakpoint
CREATE INDEX "crm_lead_entity_idx" ON "crm_lead" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "crm_payment_invoice_idx" ON "crm_payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "crm_payment_received_idx" ON "crm_payment" USING btree ("received_on");--> statement-breakpoint
CREATE INDEX "crm_quote_deal_idx" ON "crm_quote" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "crm_quote_line_quote_idx" ON "crm_quote_line" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE INDEX "crm_service_price_idx" ON "crm_service_price" USING btree ("service_id","valid_from");