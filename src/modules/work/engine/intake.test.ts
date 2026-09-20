import { describe, expect, it } from "vitest";
import { checkAnswers, describeAnswers, dueDateFrom, formProblem, type IntakeField } from "./intake";

const fields: IntakeField[] = [
  { key: "f1", label: "Nội dung cần thiết kế", type: "long_text", required: true },
  { key: "f2", label: "Kích thước", type: "select", required: true, options: ["1080x1080", "1920x1080"] },
  { key: "f3", label: "Cần trước ngày", type: "date", required: false },
  { key: "f4", label: "Link brief", type: "url", required: false },
];

describe("formProblem", () => {
  it("accepts a sound form and names what is wrong with a bad one", () => {
    expect(formProblem(fields)).toBeNull();
    expect(formProblem([])).toBe("intake_fields_required");
    expect(formProblem([{ ...fields[0], label: " " }])).toBe("intake_field_label_required");
    expect(formProblem([fields[0], { ...fields[1], key: "f1" }])).toBe("intake_field_key_duplicate");
    expect(formProblem([{ ...fields[1], options: ["one"] }])).toBe("intake_select_needs_options");
    expect(formProblem(Array.from({ length: 13 }, (_, index) => ({ ...fields[0], key: `f${index}` })))).toBe("intake_too_many_fields");
  });
});

describe("checkAnswers", () => {
  it("keeps good answers, drops unknown keys, and reports every problem at once", () => {
    expect(checkAnswers(fields, { f1: " Banner 9.9 ", f2: "1080x1080", f3: "2026-09-30", f4: "https://drive.google.com/x", other: "x" })).toEqual({ answers: { f1: "Banner 9.9", f2: "1080x1080", f3: "2026-09-30", f4: "https://drive.google.com/x" }, problems: [] });
    expect(checkAnswers(fields, { f1: "", f2: "A4", f3: "30/09/2026", f4: "http://plain" }).problems).toEqual([
      { key: "f1", problem: "required" },
      { key: "f2", problem: "not_an_option" },
      { key: "f3", problem: "not_a_date" },
      { key: "f4", problem: "not_a_url" },
    ]);
    expect(checkAnswers(fields, { f1: "x".repeat(4001), f2: "1080x1080" }).problems).toEqual([{ key: "f1", problem: "too_long" }]);
  });
});

describe("describeAnswers (golden)", () => {
  it("renders the answers in the form's order and takes the first date as the due date", () => {
    const answers = { f1: "Banner 9.9\nhai phiên bản", f2: "1080x1080", f3: "2026-09-30" };
    expect(describeAnswers("Yêu cầu thiết kế", fields, answers)).toBe("[Yêu cầu thiết kế]\n\nNội dung cần thiết kế:\nBanner 9.9\nhai phiên bản\n\nKích thước: 1080x1080\n\nCần trước ngày: 30/09/2026");
    expect(dueDateFrom(fields, answers)).toBe("2026-09-30");
    expect(dueDateFrom(fields, { f1: "x" })).toBeNull();
  });
});
