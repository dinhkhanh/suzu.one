ALTER TABLE "kb_space" ADD COLUMN "owner_project_id" uuid;--> statement-breakpoint
CREATE INDEX "kb_space_owner_project_idx" ON "kb_space" USING btree ("owner_project_id");