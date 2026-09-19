-- Approved versions of one parameter never overlap (ADR-07); btree_gist is already installed (0005).
ALTER TABLE "statutory_parameter" ADD CONSTRAINT "statutory_parameter_no_overlap"
  EXCLUDE USING gist ("key" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("status" = 'approved');
--> statement-breakpoint
ALTER TABLE "statutory_parameter" ADD CONSTRAINT "statutory_parameter_dates_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
