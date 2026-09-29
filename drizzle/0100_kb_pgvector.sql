-- Knowledge-base vectors move to pgvector, ranked in SQL (src/modules/kb/chunks.ts). Always in the
-- `extensions` schema — where Supabase keeps extensions, and made here for plain Postgres (PGlite in
-- the tests) — so the code can name `extensions.vector` and `OPERATOR(extensions.<=>)` everywhere.
CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;--> statement-breakpoint
-- A new column beside `embedding real[]`, not a change of its type: the deployment still running
-- while this migrates reads and writes the array. A chunk it embeds in the meantime has no
-- `embedding_vector`, and the `kb-embeddings` job fills it in.
ALTER TABLE "kb_page_chunk" ADD COLUMN "embedding_vector" extensions.vector;--> statement-breakpoint
UPDATE "kb_page_chunk" SET "embedding_vector" = "embedding"::extensions.vector WHERE "embedding" IS NOT NULL;
