CREATE TABLE "competency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"search_name" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competency_kind_search_name_key" UNIQUE("kind","search_name"),
	CONSTRAINT "competency_kind_check" CHECK ("competency"."kind" IN ('profession', 'skill'))
);
--> statement-breakpoint
ALTER TABLE "competency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person_competency" (
	"person_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"added_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_competency_person_id_competency_id_pk" PRIMARY KEY("person_id","competency_id")
);
--> statement-breakpoint
ALTER TABLE "person_competency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "competency" ADD CONSTRAINT "competency_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_competency" ADD CONSTRAINT "person_competency_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_competency" ADD CONSTRAINT "person_competency_competency_id_competency_id_fk" FOREIGN KEY ("competency_id") REFERENCES "public"."competency"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_competency" ADD CONSTRAINT "person_competency_added_by_person_id_person_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_competency_competency_idx" ON "person_competency" USING btree ("competency_id");