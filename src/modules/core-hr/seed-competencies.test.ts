import { describe, expect, it } from "vitest";
import { capitalizeWords, toSearchKey } from "@/lib/text";
import { MAX_COMPETENCY_NAME } from "./enums";
import { COMPETENCY_SEED, competencySeedRows } from "./seed-competencies";

describe("the starter catalogue of professional fields and skills", () => {
  it("is written the way the app stores a name: every word capitalised, within the length limit", () => {
    for (const row of competencySeedRows()) {
      expect(capitalizeWords(row.name), row.name).toBe(row.name);
      expect(row.name.length, row.name).toBeLessThanOrEqual(MAX_COMPETENCY_NAME);
      expect(row.searchName).toBe(toSearchKey(row.name));
    }
  });

  it("names nothing twice within a kind, and keeps the two lists apart", () => {
    for (const kind of ["profession", "skill"] as const) {
      const keys = COMPETENCY_SEED[kind].map(toSearchKey);
      expect(new Set(keys).size, kind).toBe(keys.length);
    }
    // A name in both lists would be offered twice to somebody filling in a profile.
    const fields = new Set(COMPETENCY_SEED.profession.map(toSearchKey));
    expect(COMPETENCY_SEED.skill.filter((name) => fields.has(toSearchKey(name)))).toEqual([]);
    expect(COMPETENCY_SEED.profession.length).toBeGreaterThan(20);
    expect(COMPETENCY_SEED.skill.length).toBeGreaterThan(20);
  });
});
