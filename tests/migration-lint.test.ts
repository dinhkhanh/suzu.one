// The migration lint (ENG-02, tests/helpers/migration-lint.ts) over every migration written after
// it existed. The ones before it are grandfathered: they are deployed, and rewriting a deployed
// migration changes nothing in a database that already ran it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findingsOf, lintMigration } from "./helpers/migration-lint";

/**
 * The last migration written before the lint: everything after it is checked. 0115–0131 came from
 * Phase 12 bundles built alongside it and were read by hand when they were merged.
 */
const GRANDFATHERED_THROUGH = 131;

const FOLDER = join(import.meta.dirname, "..", "drizzle");
const journal = JSON.parse(readFileSync(join(FOLDER, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
const checked = journal.entries.filter((entry) => entry.idx > GRANDFATHERED_THROUGH).map((entry) => ({ tag: entry.tag, sql: readFileSync(join(FOLDER, `${entry.tag}.sql`), "utf8") }));

describe("every migration after the grandfathered ones", () => {
  it("is backward-compatible and bounds its lock wait", () => {
    // A finding here: make the change additive, or add `-- migration-lint: allow <rule> — <why it is safe>`.
    // A missing lock_timeout: start the file with `SET lock_timeout = '5s';--> statement-breakpoint`.
    const findings = Object.fromEntries(checked.map(({ tag, sql }) => [tag, lintMigration(sql)]).filter(([, found]) => found.length > 0));
    expect(findings).toEqual({});
  });
});

describe("the lint itself", () => {
  const LOCKED = "SET lock_timeout = '5s';--> statement-breakpoint\n";
  const rules = (sql: string) => lintMigration(LOCKED + sql).map((finding) => finding.rule);

  it("passes what drizzle writes for an additive change", () => {
    expect(
      rules(`CREATE TABLE "a" ("id" uuid PRIMARY KEY NOT NULL, "n" integer NOT NULL);--> statement-breakpoint
ALTER TABLE "a" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "b" ADD COLUMN "flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "b" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "a" ADD COLUMN "late" text NOT NULL;--> statement-breakpoint
CREATE INDEX "a_n_idx" ON "a" USING btree ("n");`),
    ).toEqual([]);
  });

  it("finds each destructive change", () => {
    expect(rules(`DROP TABLE "x";`)).toEqual(["drop_table"]);
    expect(rules(`ALTER TABLE "x" DROP COLUMN "y";`)).toEqual(["drop_column"]);
    expect(rules(`DROP TYPE "public"."e";`)).toEqual(["drop_type"]);
    expect(rules(`TRUNCATE "x";`)).toEqual(["truncate"]);
    expect(rules(`ALTER TABLE "x" RENAME COLUMN "a" TO "b";`)).toEqual(["rename"]);
    expect(rules(`ALTER TABLE "x" ALTER COLUMN "a" SET DATA TYPE smallint;`)).toEqual(["alter_type"]);
    expect(rules(`ALTER TABLE "x" ALTER COLUMN "a" SET NOT NULL;`)).toEqual(["set_not_null"]);
    expect(rules(`ALTER TABLE "x" ADD COLUMN "a" text NOT NULL;`)).toEqual(["not_null_without_default"]);
  });

  it("wants a lock_timeout", () => {
    expect(findingsOf(`CREATE TABLE "a" ("id" uuid);`).map((finding) => finding.rule)).toEqual(["lock_timeout"]);
    expect(findingsOf(`SET LOCAL lock_timeout = '3s';--> statement-breakpoint\nCREATE TABLE "a" ("id" uuid);`)).toEqual([]);
  });

  it("does not read a commented-out statement", () => {
    expect(rules(`-- DROP TABLE "x";\nCREATE TABLE "y" ("id" uuid);`)).toEqual([]);
  });

  it("takes an allowance only with the rule's name and a reason", () => {
    expect(rules(`-- migration-lint: allow drop_column — nothing has read "y" since 0098\nALTER TABLE "x" DROP COLUMN "y";`)).toEqual([]);
    expect(rules(`-- migration-lint: allow drop_column\nALTER TABLE "x" DROP COLUMN "y";`)).toEqual(["drop_column"]);
    expect(rules(`-- migration-lint: allow drop_table — the table was never read\nALTER TABLE "x" DROP COLUMN "y";`)).toEqual(["drop_column"]);
    expect(lintMigration(`-- migration-lint: allow lock_timeout — only new tables, nobody holds them\nCREATE TABLE "a" ("id" uuid);`)).toEqual([]);
  });
});
