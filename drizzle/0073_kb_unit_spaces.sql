-- A space of one's own, at every level (SRS D19, FR-KB-13): a space may belong to an org unit,
-- and then its head runs it — settings, pages, and who outside the unit may see it — without HR.
-- Nothing existing changes: every space made so far stays a company or entity space (null).
ALTER TABLE "kb_space" ADD COLUMN "owner_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "kb_space" ADD CONSTRAINT "kb_space_owner_unit_id_org_unit_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_space_owner_unit_idx" ON "kb_space" USING btree ("owner_unit_id");--> statement-breakpoint
-- One space per unit: a second one would split the team's own knowledge in two.
CREATE UNIQUE INDEX "kb_space_owner_unit_key" ON "kb_space" ("owner_unit_id") WHERE "owner_unit_id" IS NOT NULL;
