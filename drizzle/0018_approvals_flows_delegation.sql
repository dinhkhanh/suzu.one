CREATE TABLE "approval_delegation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"request_types" text[],
	"reason" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_delegation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approval_flow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" text NOT NULL,
	"entity_id" uuid,
	"definition" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_flow_type_entity_key" UNIQUE NULLS NOT DISTINCT("request_type","entity_id")
);
--> statement-breakpoint
ALTER TABLE "approval_flow" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_step" ADD COLUMN "parallel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_from_person_id_person_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_to_person_id_person_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_flow" ADD CONSTRAINT "approval_flow_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_flow" ADD CONSTRAINT "approval_flow_updated_by_person_id_person_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegation_from_idx" ON "approval_delegation" USING btree ("from_person_id","valid_from","valid_to");