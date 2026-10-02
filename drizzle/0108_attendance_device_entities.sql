CREATE TABLE "attendance_device_entity" (
	"device_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "attendance_device_entity_device_id_entity_id_pk" PRIMARY KEY("device_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "attendance_device_entity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_device_entity" ADD CONSTRAINT "attendance_device_entity_device_id_attendance_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_entity" ADD CONSTRAINT "attendance_device_entity_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_device_entity_entity_idx" ON "attendance_device_entity" USING btree ("entity_id");