// Names as people type them: misspelt, shortened, reordered, unmarked, or as initials — and what
// is not a name at all stays not found.
import { describe, expect, it } from "vitest";
import { editDistance, pickNamedRow, rankNamed, scoreName } from "./name-match";

const PEOPLE = ["Hồ Gia Huy", "Dương Thùy Chi", "Huỳnh Mỹ Duyên", "Nguyễn Thị Hoa", "Nguyễn Anh Tuấn", "Trần Hoàng Long", "Lê Thị Mai"].map((fullName) => ({ fullName }));
const PROJECTS = [
  { name: "Tết Campaign 2026", jobNumber: "SZM-26-042", client: "Vinamilk" },
  { name: "Tết Campaign 2025", jobNumber: "SZM-25-007", client: "Vinamilk" },
  { name: "Marketing Website Redesign", jobNumber: "SZM-26-051", client: "Highlands Coffee" },
  { name: "Brand Video Q4", jobNumber: "SZM-26-060", client: null },
];
const person = (query: string) => rankNamed(PEOPLE, query, (row) => [row.fullName]).map((match) => match.row.fullName);
const project = (query: string) => rankNamed(PROJECTS, query, (row) => [row.name, row.jobNumber, row.client]).map((match) => match.row.name);
const band = (query: string) => rankNamed(PEOPLE, query, (row) => [row.fullName])[0]?.band;

describe("editDistance", () => {
  it("counts an adjacent swap as one edit", () => {
    expect(editDistance("campaign", "campaign")).toBe(0);
    expect(editDistance("campain", "campaign")).toBe(1);
    expect(editDistance("cmapaign", "campaign")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("stops early once past the limit", () => {
    expect(editDistance("abcdefgh", "zyxwvuts", 2)).toBe(3);
  });
});

describe("people", () => {
  it("finds a name without its marks, in any order, by whole words", () => {
    expect(person("Huy")).toEqual(["Hồ Gia Huy"]);
    expect(person("tuan anh")).toEqual(["Nguyễn Anh Tuấn"]);
    expect(person("Nguyen Thi Hoa")).toEqual(["Nguyễn Thị Hoa"]);
    expect(band("Huy")).toBe("whole");
  });

  it("keeps the partial matches when no name holds the word whole", () => {
    expect(person("Hu")).toHaveLength(3);
    expect(band("Hu")).toBe("partial");
  });

  it("guesses a misspelt name, and says it guessed", () => {
    expect(person("Huyy")).toEqual(["Hồ Gia Huy"]);
    expect(person("Nguyen Tuan Ahn")).toEqual(["Nguyễn Anh Tuấn"]);
    expect(person("Hoang Lnog")).toEqual(["Trần Hoàng Long"]);
    expect(band("Huyy")).toBe("guess");
  });

  it("guesses initials", () => {
    expect(person("NTH")).toEqual(["Nguyễn Thị Hoa"]);
    expect(person("THL")).toEqual(["Trần Hoàng Long"]);
  });

  it("finds nobody for a name nobody has", () => {
    expect(person("khong ai ten nay")).toEqual([]);
    expect(person("Zxq")).toEqual([]);
  });

  it("does not stretch a short name into another: three letters take no typo", () => {
    expect(person("Lam")).toEqual([]);
  });
});

describe("projects", () => {
  it("prefers an exact job number to names that hold its digits", () => {
    expect(project("SZM-26-042")).toEqual(["Tết Campaign 2026"]);
    expect(project("szm26042")).toEqual(["Tết Campaign 2026"]);
  });

  it("finds a shortened name and the words in another order", () => {
    expect(project("Tet camp 26")).toEqual(["Tết Campaign 2026"]);
    expect(project("website marketing")).toEqual(["Marketing Website Redesign"]);
    expect(project("Tet camp")).toEqual(["Tết Campaign 2026", "Tết Campaign 2025"]);
  });

  it("guesses typos and abbreviations", () => {
    expect(project("Tet Campain 2026")).toEqual(["Tết Campaign 2026"]);
    expect(project("mkt website")).toEqual(["Marketing Website Redesign"]);
    expect(project("Websit Redesing")).toEqual(["Marketing Website Redesign"]);
    expect(project("MWR")).toEqual(["Marketing Website Redesign"]);
  });

  it("finds a project by its client", () => {
    expect(project("vinamilk")).toEqual(["Tết Campaign 2026", "Tết Campaign 2025"]);
    expect(project("Highland")).toEqual(["Marketing Website Redesign"]);
  });

  it("does not misspell a number", () => {
    expect(project("Tet Campaign 2027")).toEqual([]);
  });
});

describe("pickNamedRow", () => {
  const TYPES = [
    { code: "AL", name: "Phép năm" },
    { code: "SL", name: "Nghỉ ốm" },
    { code: "UL", name: "Nghỉ không lương" },
  ];
  const pick = (query: string) => pickNamedRow(TYPES, query, (row) => [row.code, row.name]);

  it("takes the one a code or whole name means", () => {
    expect(pick("al")).toEqual({ one: TYPES[0], guessed: false });
    expect(pick("phep nam")).toEqual({ one: TYPES[0], guessed: false });
  });

  it("asks between names a word fits equally", () => {
    expect(pick("nghi")).toEqual({ many: [TYPES[1], TYPES[2]], guessed: false });
  });

  it("takes a clear guess, flagged", () => {
    expect(pick("phep nma")).toEqual({ one: TYPES[0], guessed: true });
    expect(pick("nghi om")).toEqual({ one: TYPES[1], guessed: false });
  });

  it("finds none for nothing like it", () => {
    expect(pick("thai san")).toEqual({ none: true });
  });

  it("scores the exact name highest", () => {
    expect(scoreName("Phép năm", "phep nam")).toEqual({ score: 1, band: "whole" });
  });
});
