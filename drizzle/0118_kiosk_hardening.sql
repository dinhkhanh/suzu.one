CREATE TABLE "attendance_endpoint_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_endpoint_hit_key" UNIQUE("bucket","key_hash","window_start")
);
--> statement-breakpoint
ALTER TABLE "attendance_endpoint_hit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "punch" ADD COLUMN "kiosk_session_id" uuid;--> statement-breakpoint
CREATE INDEX "attendance_endpoint_hit_window_idx" ON "attendance_endpoint_hit" USING btree ("window_start");--> statement-breakpoint
ALTER TABLE "punch" ADD CONSTRAINT "punch_kiosk_session_id_kiosk_session_id_fk" FOREIGN KEY ("kiosk_session_id") REFERENCES "public"."kiosk_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "punch_kiosk_session_idx" ON "punch" USING btree ("kiosk_session_id","at") WHERE "punch"."kiosk_session_id" is not null;