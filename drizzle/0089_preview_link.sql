CREATE TABLE "work_preview_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_preview_hit_key" UNIQUE("bucket","key_hash","window_start")
);
--> statement-breakpoint
ALTER TABLE "work_preview_hit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_preview_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"token_hash" text NOT NULL,
	"label" text,
	"message" text,
	"allow_decision" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_person_id" uuid,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_preview_link_token_key" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "work_preview_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_preview_link" ADD CONSTRAINT "work_preview_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_preview_link" ADD CONSTRAINT "work_preview_link_deliverable_id_work_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."work_deliverable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_preview_link" ADD CONSTRAINT "work_preview_link_revoked_by_person_id_person_id_fk" FOREIGN KEY ("revoked_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_preview_link" ADD CONSTRAINT "work_preview_link_decision_id_work_deliverable_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."work_deliverable_decision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_preview_link" ADD CONSTRAINT "work_preview_link_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_preview_hit_window_idx" ON "work_preview_hit" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "work_preview_link_task_idx" ON "work_preview_link" USING btree ("task_id","created_at");