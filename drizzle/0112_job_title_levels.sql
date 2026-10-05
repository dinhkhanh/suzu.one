ALTER TABLE "assignment" ADD COLUMN "seniority_level" text;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "position_level" text;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD COLUMN "seniority_level" text;--> statement-breakpoint
ALTER TABLE "hiring_request" ADD COLUMN "position_level" text;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "seniority_level" text;--> statement-breakpoint
ALTER TABLE "job_offer" ADD COLUMN "position_level" text;--> statement-breakpoint
ALTER TABLE "job_opening" ADD COLUMN "seniority_level" text;--> statement-breakpoint
ALTER TABLE "job_opening" ADD COLUMN "position_level" text;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_seniority_level_check" CHECK ("assignment"."seniority_level" IS NULL OR "assignment"."seniority_level" IN ('intern', 'junior', 'mid', 'senior'));--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_position_level_check" CHECK ("assignment"."position_level" IS NULL OR "assignment"."position_level" IN ('executive', 'leader', 'manager', 'director', 'c_level'));--> statement-breakpoint
-- Hand-written: what the free-text level already says is read into the two ladders, as far as it
-- names one — "Senior", "Middle", "Senior Manager", "Trưởng nhóm". Text that names neither stays
-- in `job_level`, which nothing reads any more; the column is dropped in a later migration, once
-- the code that wrote it is out of production.
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['assignment', 'hiring_request', 'job_opening', 'job_offer'] LOOP
    EXECUTE format($sql$
      UPDATE %I SET
        "seniority_level" = CASE
          WHEN "job_level" ~* '\m(intern|tts)\M|thực tập' THEN 'intern'
          WHEN "job_level" ~* '\m(junior|jr|fresher)\M' THEN 'junior'
          WHEN "job_level" ~* '\m(mid|middle|mid-level)\M' THEN 'mid'
          WHEN "job_level" ~* '\m(senior|sr)\M' THEN 'senior'
        END,
        "position_level" = CASE
          WHEN "job_level" ~* '\mc[- ]?level\M|\m(ceo|coo|cfo|cmo|cto)\M|tổng giám đốc' THEN 'c_level'
          WHEN "job_level" ~* '\mdirector\M|giám đốc' THEN 'director'
          WHEN "job_level" ~* '\mmanager\M|quản lý|trưởng phòng' THEN 'manager'
          WHEN "job_level" ~* '\m(leader|lead)\M|trưởng nhóm' THEN 'leader'
          WHEN "job_level" ~* '\m(executive|staff)\M|nhân viên|chuyên viên' THEN 'executive'
        END
      WHERE "job_level" IS NOT NULL AND "seniority_level" IS NULL AND "position_level" IS NULL
    $sql$, target);
  END LOOP;
END $$;