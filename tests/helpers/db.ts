// A real Postgres (PGlite) standing in for `@/lib/db` in service tests:
//   vi.mock("@/lib/db", () => import("<relative path>/tests/helpers/db"));
// Each test file gets its own empty database; call `migrateTestDb()` in `beforeAll`.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";

const database = drizzle(new PGlite({ extensions: { btree_gist } }), { schema });

export const db = () => database;
export { schema };

export async function migrateTestDb(): Promise<void> {
  await migrate(database, { migrationsFolder: "./drizzle" });
}
