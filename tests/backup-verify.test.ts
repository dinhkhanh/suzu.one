// The checks a restored backup must pass (scripts/backup/verify.sql) still fit the schema the
// migrations build: a migration that renames a column they read breaks this test, not the night's
// backup (docs/BACKUP_PLAN.md §3.4).
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const VERIFY = readFileSync("scripts/backup/verify.sql", "utf8");
const client = new PGlite({ extensions: { btree_gist, vector } });

beforeAll(async () => {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
}, 120_000);

describe("backup verify.sql", () => {
  it("runs every check against the migrated schema", async () => {
    // Structure mode: an empty database fails the data checks by design; every query still runs.
    await client.exec(`set backup.check_mode = 'structure'; ${VERIFY}`);
  });

  it("refuses a database with no data in it", async () => {
    await expect(client.exec(`set backup.check_mode = 'full'; ${VERIFY}`)).rejects.toThrow(/backup check failed: migrations recorded|backup check failed: active people/);
  });

  it("names the failed check and nothing else", async () => {
    await expect(client.exec(`set backup.check_mode = 'full'; ${VERIFY}`)).rejects.toThrow(/^backup check failed: [a-z ]+$/);
  });
});
