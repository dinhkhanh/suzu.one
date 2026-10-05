import { describe, expect, it } from "vitest";
import { jobTitle, POSITION_LEVELS, POSITION_SPELLINGS, SENIORITY_LEVELS, SENIORITY_SPELLINGS } from "./job-levels";

const WORDS: Record<string, string> = {
  "seniorityLevel.intern": "Intern",
  "seniorityLevel.junior": "Junior",
  "seniorityLevel.mid": "Mid-level",
  "seniorityLevel.senior": "Senior",
  "positionLevel.executive": "Executive",
  "positionLevel.leader": "Leader",
  "positionLevel.manager": "Manager",
  "positionLevel.director": "Director",
  "positionLevel.c_level": "C-level",
};
const label = (key: string) => WORDS[key];

describe("jobTitle", () => {
  it("reads the two levels as one title, seniority first", () => {
    expect(jobTitle(label, { seniorityLevel: "senior", positionLevel: "manager" })).toBe("Senior Manager");
    expect(jobTitle(label, { seniorityLevel: "mid", positionLevel: "executive" })).toBe("Mid-level Executive");
  });

  it("shows the half that is set, and nothing when neither is", () => {
    expect(jobTitle(label, { seniorityLevel: "junior", positionLevel: null })).toBe("Junior");
    expect(jobTitle(label, { seniorityLevel: null, positionLevel: "director" })).toBe("Director");
    expect(jobTitle(label, { seniorityLevel: null, positionLevel: null })).toBeNull();
    expect(jobTitle(label, null)).toBeNull();
    // A row cached before the columns existed has neither field.
    expect(jobTitle(label, {})).toBeNull();
  });

  it("ignores a value that is on neither ladder", () => {
    expect(jobTitle(label, { seniorityLevel: "L3", positionLevel: "manager" })).toBe("Manager");
  });
});

describe("the spellings an import accepts", () => {
  it("cover every level, and no spelling names two levels", () => {
    expect(Object.keys(SENIORITY_SPELLINGS)).toEqual([...SENIORITY_LEVELS]);
    expect(Object.keys(POSITION_SPELLINGS)).toEqual([...POSITION_LEVELS]);
    const all = [...Object.values(SENIORITY_SPELLINGS), ...Object.values(POSITION_SPELLINGS)].flat().map((word) => word.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });
});
