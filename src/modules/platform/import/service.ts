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

/** What was uploaded, for an import that reads its own format (a clock's `attlog.dat`). */
export type UploadedFile = { name: string; extension: string; bytes: Buffer };

export type ImportDefinition<C extends Columns, P = void> = {
  /** Also the audit resource type: "import:<kind>". */
  kind: string;
  columns: C;
  /** What is chosen beside the file (which device a log came from): the form's other fields. Kept with the batch. */
  params?: z.ZodType<P>;
  /** Compensation-tier data (a payroll spreadsheet): both steps then need a recent re-authentication (FR-PLT-06). */
  stepUp?: boolean;
  /** File types this import takes; default .xlsx and .csv. Anything else must be text and needs `readTable`. */
  extensions?: readonly string[];
  /** Turns the upload into a table whose first row carries this import's headers. Default: the sheet or CSV as it is. */
  readTable?: (file: UploadedFile, params: P, user: CurrentUser) => Promise<{ table: Cell[][]; headerless?: boolean }>;
  authorize: (user: CurrentUser, params: P | undefined) => boolean | Promise<boolean>;
  /** Checks that need the database: duplicates, references to things that must exist. A problem with `severity: "warning"` is shown but does not stop the commit. */
  validate?: (rows: ParsedRow<C>[], user: CurrentUser, params: P) => Promise<Problem[]>;
  /** Writes every row inside one transaction: an import lands completely or not at all. */
  commit: (rows: ParsedRow<C>[], tx: Tx, user: CurrentUser, params: P, batchId?: string) => Promise<Record<string, number>>;
  onCommitted?: () => void | Promise<void>;
};

export type StagedImport = {
  batchId: string;
  status: "invalid" | "ready";
  rowCount: number;
  problemCount: number;
  warningCount: number;
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

const blocks = (problem: Problem) => problem.code !== "column_unknown" && problem.severity !== "warning";

async function readUpload(file: File, extensions: readonly string[]): Promise<UploadedFile> {
  const name = cleanFileName(file.name);
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (!extensions.includes(extension)) throw new ActionError("import_file_type");
  if (file.size === 0 || file.size > MAX_IMPORT_BYTES) throw new ActionError("import_file_size");
  const bytes = Buffer.from(await file.arrayBuffer());
  // Spreadsheets must look like their type; every other accepted type is text and may hold no NUL byte.
  const genuine = extension === "xlsx" || extension === "csv" ? matchesSignature(name, bytes.subarray(0, 512)) : !bytes.subarray(0, 4096).includes(0);
  if (!genuine) throw new ActionError("import_file_type");
  return { name, extension, bytes };
}

/** The sheet or CSV as rows of cells. Exported for imports whose `readTable` starts from it. */
export async function readSpreadsheet(file: UploadedFile): Promise<Cell[][]> {
  try {
    return file.extension === "xlsx" ? ((await readSheet(file.bytes)) as Cell[][]) : parseCsv(file.bytes.toString("utf8"));
  } catch {
    throw new ActionError("import_unreadable");
  }
}

/**
 * The two server actions every import consists of. A module wraps them in its own "use server"
 * file: `stage` parses and checks an uploaded file and stores the result; `commit` applies a
 * staged batch that had no problems. Both run the usual pipeline (authorize, audit).
 */
export function defineImport<C extends Columns, P = void>(definition: ImportDefinition<C, P>) {
  const headers = Object.values(definition.columns).map((column) => column.headers[0]);
  const extensions = definition.extensions ?? ["xlsx", "csv"];
  const paramsOf = (raw: unknown): P => (definition.params ? definition.params.parse(raw) : (undefined as P));
  const formInput = z.instanceof(FormData).transform((form, context) => {
    const file = form.get("file");
    const fields = Object.fromEntries([...form.entries()].filter(([key, value]) => key !== "file" && typeof value === "string"));
    const params = definition.params ? definition.params.safeParse(fields) : { success: true as const, data: undefined as P };
    if (!(file instanceof File) || !params.success) {
      context.addIssue({ code: "custom", message: "invalid", path: [file instanceof File ? "params" : "file"] });
      return z.NEVER;
    }
    return { file, params: params.data };
  });

  const stage = createAction({
    name: `import.${definition.kind}.stage`,
    stepUp: definition.stepUp,
    input: formInput,
    authorize: (user, input) => definition.authorize(user, input.params),
    run: async ({ user, input: { file, params } }) => {
      const upload = await readUpload(file, extensions);
      const read = definition.readTable ? await definition.readTable(upload, params, user) : { table: await readSpreadsheet(upload) };
      const { rows, problems } = parseTable(read.table, definition.columns, { headerless: read.headerless });
      if (rows.length > MAX_ROWS) throw new ActionError("import_too_many_rows");
      // Everything wrong is reported in one go, so the file is fixed once, not once per kind of mistake.
      if (rows.length > 0 && definition.validate) problems.push(...(await definition.validate(rows, user, params)));
      problems.sort((a, b) => a.row - b.row);
      const blocking = problems.filter(blocks);
      const status = blocking.length > 0 || rows.length === 0 ? "invalid" : "ready";

      const batchId = randomUUID();
      const stored = transformSensitive(definition.columns, rows, (value, field) => fieldCipher().encrypt(value, cellContext(batchId, field)));
      const [batch] = await db()
        .insert(schema.importBatch)
        .values({ id: batchId, kind: definition.kind, fileName: upload.name, status, rowCount: rows.length, rows: stored, problems, params: params ?? null, createdByPersonId: user.person.id })
        .returning({ id: schema.importBatch.id });
      const data: StagedImport = {
        batchId: batch.id,
        status,
        rowCount: rows.length,
        problemCount: blocking.length,
        warningCount: problems.filter((problem) => problem.severity === "warning").length,
        problems: problems.slice(0, SHOWN_PROBLEMS),
        headers,
        preview: rows.slice(0, PREVIEW_ROWS).map(({ row, values }) => ({ row, cells: Object.entries(definition.columns).map(([field, column]) => {
          const value = (values as Record<string, unknown>)[field] ?? "";
          return column.sensitive && value !== "" ? MASK : String(value);
        }) })),
      };
      return { data, audit: { resource: { type: `import:${definition.kind}`, id: batch.id }, summary: `${upload.name}: ${rows.length} rows, ${blocking.length} problems` } };
    },
  });

  const commit = createAction({
    name: `import.${definition.kind}.commit`,
    stepUp: definition.stepUp,
    input: z.object({ batchId: z.uuid() }),
    // Whether this person may commit *this* batch is decided below, against the batch's own parameters.
    authorize: (user) => definition.authorize(user, undefined),
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
        const params = paramsOf(batch.params);
        if (definition.params && !(await definition.authorize(user, params))) throw new ActionError("import_batch_not_found");
        const rows = transformSensitive(definition.columns, batch.rows as ParsedRow<C>[], (value, field) => fieldCipher().decrypt(value, cellContext(batch.id, field)));
        // The database may have moved on since the preview.
        if (definition.validate && (await definition.validate(rows, user, params)).some(blocks)) throw new ActionError("import_stale");
        const counts = await definition.commit(rows, tx as Tx, user, params, batch.id);
        await tx.update(batches).set({ status: "committed", committedAt: new Date(), result: counts }).where(eq(batches.id, batch.id));
        return { fileName: batch.fileName, counts };
      });
      await definition.onCommitted?.();
      return { data: result.counts, audit: { resource: { type: `import:${definition.kind}`, id: input.batchId }, summary: `${result.fileName}: ${JSON.stringify(result.counts)}`, after: result.counts } };
    },
  });

  // The definition comes back with the two actions so that a module can test what its import
  // demands of a caller (who may run it, whether it needs a re-authentication) without going
  // through a file upload.
  return { stage, commit, definition };
}
