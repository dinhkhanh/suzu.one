// What of a tool's result a model may read (FR-AGT-30, design rule 3). Pure.
//
// A tool reads rows through its module, as the asker — so everything in them is already something
// the asker may see. The model gets less: an ALLOW-LIST of fields per tool, never a filter over
// what the module happened to return, so a column a module adds next year reaches no model until
// somebody names it here. Free text in the allowed fields (a task's title, a blocker's reason, a
// plan's note) passes Phase 9's contact redaction: a phone number in a task title is still a phone
// number. And at most `cap` rows: the rest are counted, and the model is told to send the person to
// the screen.
import { redactContacts } from "./redact";

/** `value`: an id, a date, a number, an enum — sent as it is. `text`: words somebody typed — redacted and cut. */
export type FieldRule = "value" | "text";

export type ViewSpec<Row> = { readonly [Key in keyof Row]?: FieldRule };

const TEXT_MAX = 300;

/** Words somebody typed, on their way to a model: no contact detail, and not a page of them. */
export function modelText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = redactContacts(value).replace(/\s+/gu, " ").trim();
  if (!text) return null;
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX).trimEnd()}…` : text;
}

/** One row, reduced to the allowed fields. A field the spec does not name is not there. */
export function modelRow<Row extends object>(row: Row, spec: ViewSpec<Row>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(spec) as [keyof Row & string, FieldRule][]) {
    const value = row[key];
    if (value === undefined) continue;
    out[key] = rule === "text" ? modelText(typeof value === "string" ? value : value == null ? null : String(value)) : value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

export type ModelRows = { rows: Record<string, unknown>[]; total: number; /** Rows not sent: "and N more — open the screen". */ more: number };

/** The first `cap` rows, reduced; the count of the rest. */
export function modelRows<Row extends object>(rows: readonly Row[], spec: ViewSpec<Row>, cap: number): ModelRows {
  const shown = rows.slice(0, Math.max(0, cap));
  return { rows: shown.map((row) => modelRow(row, spec)), total: rows.length, more: rows.length - shown.length };
}
