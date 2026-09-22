import { describe, expect, it } from "vitest";
import { applicableFields, checkCustomValue, compareCustomValues, currentValue, customGroupKeys, displayCustomValue, fieldDefinitionProblem, fieldIdOf, formatDuration, matchesCustomFilter } from "./custom-fields";

const options = [
  { id: "a", label: "Reels" },
  { id: "b", label: "TVC" },
  { id: "c", label: "Story" },
];
const field = (type: string, extra: object = {}) => ({ id: "f", name: "Field", type: type as never, options, teamId: "vid", projectId: null, isActive: true, ...extra });
const PERSON = "8b1f6a3e-2c4d-4e5f-9a0b-1c2d3e4f5a6b";

describe("field definitions", () => {
  it("need a name, a known type and, for choices, distinct options", () => {
    expect(fieldDefinitionProblem({ name: " ", type: "text", options: [] })).toBe("custom_field_name_required");
    expect(fieldDefinitionProblem({ name: "Tỉ lệ", type: "colour", options: [] })).toBe("custom_field_type_invalid");
    expect(fieldDefinitionProblem({ name: "Tỉ lệ", type: "select", options: [] })).toBe("custom_field_needs_options");
    expect(fieldDefinitionProblem({ name: "Tỉ lệ", type: "select", options: [{ id: "a", label: "9:16" }, { id: "b", label: " 9:16" }] })).toBe("custom_field_option_duplicate");
    expect(fieldDefinitionProblem({ name: "Nền tảng", type: "multi_select", options })).toBeNull();
    expect(fieldDefinitionProblem({ name: "Link ads", type: "url", options: [] })).toBeNull();
  });
  it("apply to the team's tasks, a project's field to that project's only", () => {
    const fields = [field("text", { id: "team" }), field("text", { id: "project", projectId: "tet" }), field("text", { id: "other", teamId: "des" }), field("text", { id: "retired", isActive: false })];
    expect(applicableFields(fields, { teamId: "vid", projectId: "tet" }).map((row) => row.id)).toEqual(["team", "project"]);
    expect(applicableFields(fields, { teamId: "vid", projectId: null }).map((row) => row.id)).toEqual(["team"]);
  });
});

describe("checkCustomValue", () => {
  it("accepts each type's values and clears on blank", () => {
    expect(checkCustomValue(field("text"), "  Quay ở Đà Lạt ")).toEqual({ ok: true, value: "Quay ở Đà Lạt" });
    expect(checkCustomValue(field("number"), "12,5")).toEqual({ ok: true, value: 12.5 });
    expect(checkCustomValue(field("duration"), "90")).toEqual({ ok: true, value: 90 });
    expect(checkCustomValue(field("select"), "b")).toEqual({ ok: true, value: "b" });
    expect(checkCustomValue(field("multi_select"), ["c", "a"])).toEqual({ ok: true, value: ["a", "c"] });
    expect(checkCustomValue(field("date"), "2026-10-20")).toEqual({ ok: true, value: "2026-10-20" });
    expect(checkCustomValue(field("person"), PERSON.toUpperCase())).toEqual({ ok: true, value: PERSON });
    expect(checkCustomValue(field("url"), "https://drive.google.com/x")).toEqual({ ok: true, value: "https://drive.google.com/x" });
    expect(checkCustomValue(field("checkbox"), "on")).toEqual({ ok: true, value: true });
    expect(checkCustomValue(field("checkbox"), false)).toEqual({ ok: true, value: false });
    for (const type of ["text", "number", "select", "multi_select", "date"]) {
      expect(checkCustomValue(field(type), "")).toEqual({ ok: true, value: null });
      expect(checkCustomValue(field(type), null)).toEqual({ ok: true, value: null });
    }
    expect(checkCustomValue(field("multi_select"), [])).toEqual({ ok: true, value: null });
  });
  it("refuses what does not fit", () => {
    expect(checkCustomValue(field("text"), "x".repeat(501))).toEqual({ ok: false, problem: "too_long" });
    expect(checkCustomValue(field("text"), 5)).toEqual({ ok: false, problem: "not_text" });
    expect(checkCustomValue(field("number"), "mười")).toEqual({ ok: false, problem: "not_a_number" });
    expect(checkCustomValue(field("duration"), "1.5")).toEqual({ ok: false, problem: "not_a_duration" });
    expect(checkCustomValue(field("duration"), -5)).toEqual({ ok: false, problem: "not_a_duration" });
    expect(checkCustomValue(field("select"), "z")).toEqual({ ok: false, problem: "not_an_option" });
    expect(checkCustomValue(field("multi_select"), ["a", "z"])).toEqual({ ok: false, problem: "not_an_option" });
    expect(checkCustomValue(field("date"), "2026-02-30")).toEqual({ ok: false, problem: "not_a_date" });
    expect(checkCustomValue(field("person"), "long")).toEqual({ ok: false, problem: "not_a_person" });
    expect(checkCustomValue(field("url"), "javascript:alert(1)")).toEqual({ ok: false, problem: "not_a_url" });
  });
});

describe("stored values", () => {
  it("lose options deleted since, and read as text for the log", () => {
    const trimmed = field("multi_select", { options: options.filter((option) => option.id !== "b") });
    expect(currentValue(trimmed, ["a", "b"])).toEqual(["a"]);
    expect(currentValue(trimmed, ["b"])).toBeNull();
    expect(currentValue(field("select", { options: [options[0]] }), "b")).toBeNull();
    expect(displayCustomValue(field("multi_select"), ["a", "c"])).toBe("Reels, Story");
    expect(displayCustomValue(field("person"), PERSON, new Map([[PERSON, "Huy Ho"]]))).toBe("Huy Ho");
    expect(displayCustomValue(field("duration"), 95)).toBe("1h35");
    expect(displayCustomValue(field("date"), "2026-10-20")).toBe("20/10/2026");
    expect(displayCustomValue(field("text"), null)).toBeNull();
    expect([formatDuration(45), formatDuration(120)]).toEqual(["45m", "2h"]);
  });
});

describe("filter, sort and group by a field", () => {
  const self = { selfId: PERSON };
  it("filters every type", () => {
    expect(matchesCustomFilter(field("select"), "a", "a", self)).toBe(true);
    expect(matchesCustomFilter(field("multi_select"), ["a", "c"], "c", self)).toBe(true);
    expect(matchesCustomFilter(field("multi_select"), ["a"], "c", self)).toBe(false);
    expect(matchesCustomFilter(field("person"), PERSON, "me", self)).toBe(true);
    expect(matchesCustomFilter(field("number"), 12, ">10", self)).toBe(true);
    expect(matchesCustomFilter(field("number"), 12, "<10", self)).toBe(false);
    expect(matchesCustomFilter(field("duration"), 30, "30", self)).toBe(true);
    expect(matchesCustomFilter(field("date"), "2026-10-20", ">2026-10-01", self)).toBe(true);
    expect(matchesCustomFilter(field("text"), "Quay ở Đà Lạt", "da lat", self)).toBe(true);
    expect(matchesCustomFilter(field("checkbox"), true, "1", self)).toBe(true);
    expect(matchesCustomFilter(field("checkbox"), null, "0", self)).toBe(true);
    expect(matchesCustomFilter(field("text"), null, "~empty", self)).toBe(true);
    expect(matchesCustomFilter(field("select"), "b", "~set", self)).toBe(true);
    // A deleted option is no longer a value.
    expect(matchesCustomFilter(field("select", { options: [options[0]] }), "b", "~empty", self)).toBe(true);
  });
  it("compares by option order, number, name; empty last", () => {
    expect(compareCustomValues(field("select"), "c", "a")).toBeGreaterThan(0);
    expect(compareCustomValues(field("number"), 2, 10)).toBeLessThan(0);
    expect(compareCustomValues(field("text"), null, "a")).toBe(1);
    expect(compareCustomValues(field("checkbox"), true, false)).toBeLessThan(0);
  });
  it("groups a multi-select under each choice", () => {
    expect(customGroupKeys(field("multi_select"), ["a", "c"])).toEqual(["a", "c"]);
    expect(customGroupKeys(field("select"), null)).toEqual(["none"]);
    expect(customGroupKeys(field("checkbox"), false)).toEqual(["0"]);
  });
  it("reads field ids from URL keys", () => {
    expect(fieldIdOf(`cf.${PERSON}`)).toBe(PERSON);
    expect(fieldIdOf("cf.nope")).toBeNull();
    expect(fieldIdOf("assignee")).toBeNull();
  });
});
