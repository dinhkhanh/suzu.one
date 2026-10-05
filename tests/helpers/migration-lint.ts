// What a migration may do to a database the deployed code is still running on (ENG-02).
//
// Pushing to `main` runs the new migrations against production *before* the new build exists, and a
// build that fails after them leaves the new schema under the old code. So a migration must be
// something the code of the previous deploy survives — additive — and it must not queue behind a
// long transaction holding a lock while every request queues behind it. This reads the SQL and says
// where a migration is not that:
//
//   · drop_table, drop_column, drop_type, truncate — the old code still reads what is dropped;
//   · rename — the old code still asks for the old name;
//   · alter_type — a type change rewrites the table under an exclusive lock and may narrow it;
//   · set_not_null — the old code may still write the null;
//   · not_null_without_default — a NOT NULL column with no default, added to a table that already
//     has rows (one created in the same migration is empty, so it is fine there), fails the
//     migration, and the old code's inserts after it;
//   · lock_timeout — the migration does not bound how long it waits for a lock.
//
// A finding is allowed by a comment in the migration naming the rule and saying why it is safe:
//
//   -- migration-lint: allow drop_column — nothing has read "x" since 0098, deployed 2026-09-01
//   -- migration-lint: allow lock_timeout — only creates new tables, which nobody holds a lock on
//
// The reason is required: an allowance is a decision somebody wrote down, not a way to silence it.

export const MIGRATION_RULES = ["drop_table", "drop_column", "drop_type", "truncate", "rename", "alter_type", "set_not_null", "not_null_without_default", "lock_timeout"] as const;
export type MigrationRule = (typeof MIGRATION_RULES)[number];

export type MigrationFinding = { rule: MigrationRule; statement: string };

/** The SQL without its comments, as drizzle splits it: one statement per `--> statement-breakpoint` or `;`. */
function statementsOf(sql: string): string[] {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  return withoutComments
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** `-- migration-lint: allow <rule> — <reason>`: the rules this migration allows, each with a reason. */
export function allowancesOf(sql: string): Set<MigrationRule> {
  const allowed = new Set<MigrationRule>();
  for (const match of sql.matchAll(/--\s*migration-lint:\s*allow\s+([a-z_]+)\s*(?:—|–|-|:)\s*(\S.*)$/gm)) {
    const rule = match[1] as MigrationRule;
    if (MIGRATION_RULES.includes(rule) && match[2].trim().length >= 10) allowed.add(rule);
  }
  return allowed;
}

const unquote = (name: string) => name.replace(/"/g, "").replace(/^public\./, "");

/** Every finding in one migration, before allowances. */
export function findingsOf(sql: string): MigrationFinding[] {
  const statements = statementsOf(sql);
  const created = new Set(statements.flatMap((statement) => [...statement.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?("?[\w.]+"?(?:\."?\w+"?)?)/gi)].map((match) => unquote(match[1]))));
  const findings: MigrationFinding[] = [];
  const add = (rule: MigrationRule, statement: string) => findings.push({ rule, statement: statement.slice(0, 160) });

  for (const statement of statements) {
    const table = statement.match(/^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?("?[\w.]+"?(?:\."?\w+"?)?)/i)?.[1];
    if (/^DROP TABLE\b/i.test(statement)) add("drop_table", statement);
    if (/^DROP TYPE\b/i.test(statement)) add("drop_type", statement);
    if (/^TRUNCATE\b/i.test(statement)) add("truncate", statement);
    if (table && /\bDROP COLUMN\b/i.test(statement)) add("drop_column", statement);
    if (/^ALTER (TABLE|TYPE)\b.*\bRENAME\b/i.test(statement)) add("rename", statement);
    if (table && /\bALTER COLUMN\b.*\b(SET DATA TYPE|TYPE)\b/i.test(statement)) add("alter_type", statement);
    if (table && /\bALTER COLUMN\b.*\bSET NOT NULL\b/i.test(statement) && !created.has(unquote(table))) add("set_not_null", statement);
    if (table && /\bADD COLUMN\b/i.test(statement) && /\bNOT NULL\b/i.test(statement) && !/\bDEFAULT\b/i.test(statement) && !/\bGENERATED\b/i.test(statement) && !created.has(unquote(table))) {
      add("not_null_without_default", statement);
    }
  }
  if (!statements.some((statement) => /^SET (LOCAL )?lock_timeout\b/i.test(statement))) add("lock_timeout", "(no SET lock_timeout)");
  return findings;
}

/** What is left once the migration's own allowances are taken off. */
export function lintMigration(sql: string): MigrationFinding[] {
  const allowed = allowancesOf(sql);
  return findingsOf(sql).filter((finding) => !allowed.has(finding.rule));
}
