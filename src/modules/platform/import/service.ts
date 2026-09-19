import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { readSheet } from "read-excel-file/node";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import type { CurrentUser } from "../auth/session";
import { cleanFileName, matchesSignature } from "../files/rules";
import { type Cell, type Columns, type ParsedRow, parseCsv, parseTable, type Problem } from "./engine/table";

const MAX_IMPORT_BYTES = 4 * 1024 * 1024; // what one request may carry on the hosting platform
const MAX_ROWS = 5000;
const PREVIEW_ROWS = 50;
const SHOWN_PROBLEMS = 200;

export type ImportDefinition<C extends Columns> = {
  /** Also the audit resource type: "import:<kind>". */
  kind: string;
  columns: C;
  authorize: (user: CurrentUser) => boolean | Promise<boolean>;
  /** Checks that need the database: duplicates, references to things that must exist. */
  validate?: (rows: ParsedRow<C>[], user: CurrentUser) => Promise<Problem[]>;
  /** Writes every row inside one transaction: an import lands completely or not at all. */
  commit: (rows: ParsedRow<C>[], tx: Tx, user: CurrentUser) => Promise<Record<string, number>>;
  onCommitted?: () => void;
};

export type StagedImport = {
  batchId: string;
  status: "invalid" | "ready";
  rowCount: number;
  problemCount: number;
  problems: Problem[];
  headers: string[];
  preview: { row: number; cells: string[] }[];
};

// A staged batch sits in the database for up to a day. Cells of `sensitive` columns wait there
// encrypted, bound to their batch and column; validation and commit see them in the clear.
const MASK = "••••••";
const cellContext = (batchId: string, field: string) => `import_batch.rows:${batchId}:${field}`;

function transformSensitive<C extends Columns>(columns: C, rows: ParsedRow<C>[], transform: (value: string, field: string) => string): ParsedRow<C>[] {
  const fields = Object.entries(columns).filter(([, column]) => column.sensitive).map(([field]) => field);
  if (fields.length === 0) return rows;
  return rows.map((row) => {
    const values: Record<string, unknown> = { ...row.values };
    for (const field of fields) if (values[field] !== null && values[field] !== undefined) values[field] = transform(String(values[field]), field);
    return { row: row.row, values: values as ParsedRow<C>["values"] };
  });
}

async function readTable(file: File): Promise<Cell[][]> {
  const fileName = cleanFileName(file.name);
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension !== "xlsx" && extension !== "csv") throw new ActionError("import_file_type");
  if (file.size === 0 || file.size > MAX_IMPORT_BYTES) throw new ActionError("import_file_size");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(fileName, bytes.subarray(0, 512))) throw new ActionError("import_file_type");
  try {
    return extension === "csv" ? parseCsv(bytes.toString("utf8")) : ((await readSheet(bytes)) as Cell[][]);
  } catch {
    throw new ActionError("import_unreadable");
  }
}

/**
 * The two server actions every import consists of. A module wraps them in its own "use server"
 * file: `stage` parses and checks an uploaded file and stores the result; `commit` applies a
 * staged batch that had no problems. Both run the usual pipeline (authorize, audit).
 */
export function defineImport<C extends Columns>(definition: ImportDefinition<C>) {
  const headers = Object.values(definition.columns).map((column) => column.headers[0]);

  const stage = createAction({
    name: `import.${definition.kind}.stage`,
    input: z.instanceof(FormData).transform((form) => form.get("file")).pipe(z.instanceof(File)),
    authorize: (user) => definition.authorize(user),
    run: async ({ user, input: file }) => {
      const { rows, problems } = parseTable(await readTable(file), definition.columns);
      if (rows.length > MAX_ROWS) throw new ActionError("import_too_many_rows");
      // Everything wrong is reported in one go, so the file is fixed once, not once per kind of mistake.
      if (rows.length > 0 && definition.validate) problems.push(...(await definition.validate(rows, user)));
      problems.sort((a, b) => a.row - b.row);
      const blocking = problems.filter((problem) => problem.code !== "column_unknown");
      const status = blocking.length > 0 || rows.length === 0 ? "invalid" : "ready";

      const batchId = randomUUID();
      const stored = transformSensitive(definition.columns, rows, (value, field) => fieldCipher().encrypt(value, cellContext(batchId, field)));
      const [batch] = await db()
        .insert(schema.importBatch)
        .values({ id: batchId, kind: definition.kind, fileName: cleanFileName(file.name), status, rowCount: rows.length, rows: stored, problems, createdByPersonId: user.person.id })
        .returning({ id: schema.importBatch.id });
      const data: StagedImport = {
        batchId: batch.id,
        status,
        rowCount: rows.length,
        problemCount: blocking.length,
        problems: problems.slice(0, SHOWN_PROBLEMS),
        headers,
        preview: rows.slice(0, PREVIEW_ROWS).map(({ row, values }) => ({ row, cells: Object.entries(definition.columns).map(([field, column]) => {
          const value = (values as Record<string, unknown>)[field] ?? "";
          return column.sensitive && value !== "" ? MASK : String(value);
        }) })),
      };
      return { data, audit: { resource: { type: `import:${definition.kind}`, id: batch.id }, summary: `${cleanFileName(file.name)}: ${rows.length} rows, ${blocking.length} problems` } };
    },
  });

  const commit = createAction({
    name: `import.${definition.kind}.commit`,
    input: z.object({ batchId: z.uuid() }),
    authorize: (user) => definition.authorize(user),
    run: async ({ user, input }) => {
      const batches = schema.importBatch;
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await db().transaction(async (tx) => {
        // Only the person who staged it, only while fresh, only once.
        const [batch] = await tx
          .select()
          .from(batches)
          .where(and(eq(batches.id, input.batchId), eq(batches.kind, definition.kind), eq(batches.createdByPersonId, user.person.id), eq(batches.status, "ready"), gt(batches.createdAt, yesterday)))
          .limit(1)
          .for("update");
        if (!batch) throw new ActionError("import_batch_not_found");
        const rows = transformSensitive(definition.columns, batch.rows as ParsedRow<C>[], (value, field) => fieldCipher().decrypt(value, cellContext(batch.id, field)));
        // The database may have moved on since the preview.
        if (definition.validate && (await definition.validate(rows, user)).length > 0) throw new ActionError("import_stale");
        const counts = await definition.commit(rows, tx as Tx, user);
        await tx.update(batches).set({ status: "committed", committedAt: new Date(), result: counts }).where(eq(batches.id, batch.id));
        return { fileName: batch.fileName, counts };
      });
      definition.onCommitted?.();
      return { data: result.counts, audit: { resource: { type: `import:${definition.kind}`, id: input.batchId }, summary: `${result.fileName}: ${JSON.stringify(result.counts)}`, after: result.counts } };
    },
  });

  return { stage, commit };
}
