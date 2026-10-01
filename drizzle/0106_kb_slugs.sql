ALTER TABLE "kb_page" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "kb_page" ADD COLUMN "former_slugs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_space" ADD COLUMN "former_keys" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Every page gets its address now: its title (the published one, when there is one) without its
-- marks, as src/lib/slug.ts makes it — Vietnamese letters by hand, since this runs without the
-- unaccent extension. Where titles in one space come out the same, the oldest page keeps it and the
-- others add the start of their id; so does a page whose title comes out as one of the space's own
-- addresses ("new", "import").
UPDATE "kb_page" AS p SET "slug" = s."slug"
FROM (
  SELECT "id", CASE WHEN "n" = 1 AND "base" NOT IN ('new', 'import') THEN "base" ELSE "base" || '-' || left("id"::text, 8) END AS "slug"
  FROM (
    SELECT "id", "base", row_number() OVER (PARTITION BY "space_id", "base" ORDER BY "created_at", "id") AS "n"
    FROM (
      SELECT "id", "space_id", "created_at",
        coalesce(nullif(trim(BOTH '-' FROM left(regexp_replace(regexp_replace(translate(lower(coalesce("published_title", "title")), 'àáạảãâầấậẩẫăằắặẳẵäåāèéẹẻẽêềếệểễëēìíịỉĩïîòóọỏõôồốộổỗơờớợởỡöøùúụủũưừứựửữüûỳýỵỷỹÿđçñ', 'aaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeiiiiiiiooooooooooooooooooouuuuuuuuuuuuuyyyyyydcn'), '[\u0300-\u036f]', '', 'g'), '[^a-z0-9]+', '-', 'g'), 80)), ''), 'trang') AS "base"
      FROM "kb_page"
    ) AS b
  ) AS r
) AS s
WHERE p."id" = s."id";--> statement-breakpoint
CREATE UNIQUE INDEX "kb_page_space_slug_idx" ON "kb_page" USING btree ("space_id","slug");--> statement-breakpoint
CREATE INDEX "kb_page_former_slugs_idx" ON "kb_page" USING gin ("former_slugs");