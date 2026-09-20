CREATE TABLE "work_reminder_sent" (
	"task_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_on" date NOT NULL,
	CONSTRAINT "work_reminder_sent_task_id_person_id_kind_sent_on_pk" PRIMARY KEY("task_id","person_id","kind","sent_on")
);
--> statement-breakpoint
ALTER TABLE "work_reminder_sent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_reminder_sent" ADD CONSTRAINT "work_reminder_sent_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_reminder_sent" ADD CONSTRAINT "work_reminder_sent_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;