import { describe, expect, it } from "vitest";
import { conditionFieldsOf, flowConditionData, type FormDefinition, type FormField, formProblems, validateSubmission, visibleFields } from "./form";

const field = (partial: Partial<FormField> & Pick<FormField, "key" | "type">): FormField => ({ labelVi: "Nhãn", labelEn: "Label", ...partial });
const form = (...fields: FormField[]): FormDefinition => ({ fields });

describe("formProblems — what a designer may save", () => {
  it("accepts an empty form and a plain one", () => {
    expect(formProblems(form())).toEqual([]);
    expect(formProblems(form(field({ key: "reason", type: "textarea", required: true })))).toEqual([]);
  });

  it("refuses keys that are not identifiers, and duplicates", () => {
    expect(formProblems(form(field({ key: "Số tiền", type: "money" })))).toContain("bad_key");
    expect(formProblems(form(field({ key: "a", type: "text" }), field({ key: "a", type: "text" })))).toContain("duplicate_key");
  });

  it("wants both languages on every label", () => {
    expect(formProblems(form({ key: "a", type: "text", labelVi: "Lý do", labelEn: " " }))).toContain("no_label");
  });

  it("wants options on a choice and nowhere else", () => {
    expect(formProblems(form(field({ key: "a", type: "select" })))).toContain("options_required");
    expect(formProblems(form(field({ key: "a", type: "text", options: [{ value: "x", labelVi: "X", labelEn: "X" }] })))).toContain("options_not_allowed");
    const duplicated = form(field({ key: "a", type: "select", options: [{ value: "x", labelVi: "X", labelEn: "X" }, { value: "x", labelVi: "Y", labelEn: "Y" }] }));
    expect(formProblems(duplicated)).toContain("duplicate_option");
  });

  it("refuses a range that cannot be satisfied and a pattern that does not compile", () => {
    expect(formProblems(form(field({ key: "a", type: "number", min: 10, max: 1 })))).toContain("bad_range");
    expect(formProblems(form(field({ key: "a", type: "date", minDate: "2026-12-01", maxDate: "2026-01-01" })))).toContain("bad_range");
    expect(formProblems(form(field({ key: "a", type: "text", pattern: "([" })))).toContain("bad_pattern");
  });

  it("only lets a condition look backwards", () => {
    const self = form(field({ key: "a", type: "checkbox", visibleWhen: { field: "a", op: "eq", value: true } }));
    expect(formProblems(self)).toContain("condition_on_self");
    const unknown = form(field({ key: "a", type: "text", visibleWhen: { field: "ghost", op: "eq", value: "x" } }));
    expect(formProblems(unknown)).toContain("condition_unknown_field");
    const forward = form(field({ key: "a", type: "text", visibleWhen: { field: "b", op: "eq", value: "x" } }), field({ key: "b", type: "text" }));
    expect(formProblems(forward)).toContain("condition_forward_reference");
  });

  it("caps the number of fields", () => {
    const many = form(...Array.from({ length: 31 }, (_, index) => field({ key: `f${index}`, type: "text" })));
    expect(formProblems(many)).toContain("too_many_fields");
  });
});

describe("visibleFields — conditional fields", () => {
  const advance = form(
    field({ key: "kind", type: "select", options: [{ value: "travel", labelVi: "Công tác", labelEn: "Travel" }, { value: "other", labelVi: "Khác", labelEn: "Other" }] }),
    field({ key: "destination", type: "text", required: true, visibleWhen: { field: "kind", op: "eq", value: "travel" } }),
    field({ key: "nights", type: "number", required: true, visibleWhen: { field: "destination", op: "ne", value: "" } }),
  );

  it("shows a field only while its condition holds", () => {
    expect(visibleFields(advance, { kind: "other" }).map((entry) => entry.key)).toEqual(["kind"]);
    expect(visibleFields(advance, { kind: "travel", destination: "Đà Nẵng" }).map((entry) => entry.key)).toEqual(["kind", "destination", "nights"]);
  });

  it("hides a field whose source field is itself hidden", () => {
    // `nights` depends on `destination`, which is not shown at all: nobody was asked.
    expect(visibleFields(advance, { kind: "other", destination: "Đà Nẵng" }).map((entry) => entry.key)).toEqual(["kind"]);
  });

  it("treats a missing checkbox as false", () => {
    const withBox = form(field({ key: "urgent", type: "checkbox" }), field({ key: "why", type: "text", visibleWhen: { field: "urgent", op: "eq", value: true } }));
    expect(visibleFields(withBox, {}).map((entry) => entry.key)).toEqual(["urgent"]);
    expect(visibleFields(withBox, { urgent: true }).map((entry) => entry.key)).toEqual(["urgent", "why"]);
  });
});

describe("validateSubmission", () => {
  it("keeps only the visible fields, so a hidden answer is never stored", () => {
    const definition = form(
      field({ key: "kind", type: "select", options: [{ value: "a", labelVi: "A", labelEn: "A" }, { value: "b", labelVi: "B", labelEn: "B" }] }),
      field({ key: "note", type: "text", visibleWhen: { field: "kind", op: "eq", value: "b" } }),
    );
    const { values, problems } = validateSubmission(definition, { kind: "a", note: "secret" });
    expect(problems).toEqual([]);
    expect(values).toEqual({ kind: "a" });
  });

  it("reports a missing required answer as a key, not a sentence", () => {
    const { problems } = validateSubmission(form(field({ key: "reason", type: "text", required: true })), { reason: "  " });
    expect(problems).toEqual([{ field: "reason", problem: "required" }]);
  });

  it("reads money as it is typed in Vietnam and as it is typed elsewhere", () => {
    const definition = form(field({ key: "amount", type: "money" }));
    expect(validateSubmission(definition, { amount: "20.000.000" }).values.amount).toBe(20_000_000);
    expect(validateSubmission(definition, { amount: "20,000,000" }).values.amount).toBe(20_000_000);
    expect(validateSubmission(definition, { amount: "1 500" }).values.amount).toBe(1500);
    expect(validateSubmission(definition, { amount: 250_000 }).values.amount).toBe(250_000);
  });

  it("refuses money that is not whole đồng, is negative or is not a number at all", () => {
    const definition = form(field({ key: "amount", type: "money" }));
    expect(validateSubmission(definition, { amount: "1,5" }).problems).toEqual([{ field: "amount", problem: "not_whole_dong" }]);
    expect(validateSubmission(definition, { amount: "-5" }).problems).toEqual([{ field: "amount", problem: "out_of_range" }]);
    expect(validateSubmission(definition, { amount: "khoảng ba triệu" }).problems).toEqual([{ field: "amount", problem: "not_a_number" }]);
  });

  it("holds numbers to their bounds", () => {
    const definition = form(field({ key: "days", type: "number", min: 1, max: 30 }));
    expect(validateSubmission(definition, { days: "0" }).problems).toEqual([{ field: "days", problem: "below_min" }]);
    expect(validateSubmission(definition, { days: "31" }).problems).toEqual([{ field: "days", problem: "above_max" }]);
    expect(validateSubmission(definition, { days: "7" }).problems).toEqual([]);
  });

  it("checks dates, choices, ids and files", () => {
    expect(validateSubmission(form(field({ key: "d", type: "date" })), { d: "31/12/2026" }).problems).toEqual([{ field: "d", problem: "not_a_date" }]);
    expect(validateSubmission(form(field({ key: "d", type: "date", minDate: "2026-01-01" })), { d: "2025-12-31" }).problems).toEqual([{ field: "d", problem: "below_min" }]);
    const choice = form(field({ key: "c", type: "select", options: [{ value: "x", labelVi: "X", labelEn: "X" }] }));
    expect(validateSubmission(choice, { c: "y" }).problems).toEqual([{ field: "c", problem: "not_an_option" }]);
    expect(validateSubmission(form(field({ key: "p", type: "person" })), { p: "not-a-uuid" }).problems).toEqual([{ field: "p", problem: "not_an_id" }]);
    const files = form(field({ key: "f", type: "file" }));
    expect(validateSubmission(files, { f: Array.from({ length: 11 }, () => "11111111-1111-1111-1111-111111111111") }).problems).toEqual([{ field: "f", problem: "too_many_files" }]);
  });

  it("anchors a designer's pattern to the whole answer", () => {
    const definition = form(field({ key: "code", type: "text", pattern: "\\d{4}" }));
    expect(validateSubmission(definition, { code: "x1234y" }).problems).toEqual([{ field: "code", problem: "bad_format" }]);
    expect(validateSubmission(definition, { code: "1234" }).problems).toEqual([]);
  });

  it("holds text to its length", () => {
    const definition = form(field({ key: "t", type: "text", minLength: 3, maxLength: 5 }));
    expect(validateSubmission(definition, { t: "ab" }).problems).toEqual([{ field: "t", problem: "too_short" }]);
    expect(validateSubmission(definition, { t: "abcdef" }).problems).toEqual([{ field: "t", problem: "too_long" }]);
  });

  it("stores a multi-select as the chosen values and holds them to the options", () => {
    const definition = form(field({ key: "m", type: "multi_select", max: 2, options: [{ value: "a", labelVi: "A", labelEn: "A" }, { value: "b", labelVi: "B", labelEn: "B" }, { value: "c", labelVi: "C", labelEn: "C" }] }));
    expect(validateSubmission(definition, { m: ["a", "b"] }).values.m).toEqual(["a", "b"]);
    expect(validateSubmission(definition, { m: ["a", "b", "c"] }).problems).toEqual([{ field: "m", problem: "above_max" }]);
    expect(validateSubmission(definition, { m: ["z"] }).problems).toEqual([{ field: "m", problem: "not_an_option" }]);
  });

  it("answers a checkbox with false rather than nothing", () => {
    const { values, problems } = validateSubmission(form(field({ key: "agree", type: "checkbox" })), {});
    expect(values).toEqual({ agree: false });
    expect(problems).toEqual([]);
  });
});

describe("what a flow may condition on", () => {
  const definition = form(
    field({ key: "amount", type: "money" }),
    field({ key: "category", type: "select", options: [{ value: "it", labelVi: "CNTT", labelEn: "IT" }] }),
    field({ key: "urgent", type: "checkbox" }),
    field({ key: "note", type: "textarea" }),
    field({ key: "who", type: "person" }),
  );

  it("offers the single comparable answers only", () => {
    expect(conditionFieldsOf(definition)).toEqual(["amount", "category", "urgent"]);
  });

  it("passes those answers to the engine and leaves the rest out", () => {
    expect(flowConditionData(definition, { amount: 25_000_000, category: "it", urgent: false, note: "x", who: "id" })).toEqual({ amount: 25_000_000, category: "it", urgent: false });
  });
});
