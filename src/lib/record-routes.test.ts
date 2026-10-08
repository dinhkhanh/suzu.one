import { describe, expect, it } from "vitest";
import { recordAt, recordHref } from "./record-routes";

const ID = "0b9d7c1e-4a51-4f0e-9a43-6f1f2b7d8e90";

describe("recordAt", () => {
  it("reads the record a page is about, below its own path too", () => {
    expect(recordAt(`/projects/${ID}`)).toEqual({ kind: "project", id: ID });
    expect(recordAt(`/projects/${ID}/risks`)).toEqual({ kind: "project", id: ID });
    expect(recordAt(`/work/tasks/${ID}`)).toEqual({ kind: "task", id: ID });
    expect(recordAt(`/people/${ID.toUpperCase()}`)).toEqual({ kind: "person", id: ID });
  });

  it("takes the longest prefix: a digital asset is not an asset", () => {
    expect(recordAt(`/assets/digital/${ID}`)).toEqual({ kind: "digitalAsset", id: ID });
    expect(recordAt(`/assets/${ID}`)).toEqual({ kind: "asset", id: ID });
  });

  it("is the reverse of recordHref for every kind with a page of its own", () => {
    for (const kind of ["person", "project", "task", "team", "account", "payslip", "dailyReport"] as const) expect(recordAt(recordHref(kind, ID))).toEqual({ kind, id: ID });
  });

  it("is null for a list, a page that is not a record's and an id that is not one", () => {
    expect(recordAt("/projects")).toBeNull();
    expect(recordAt("/work/tasks/new")).toBeNull();
    expect(recordAt(`/projects/${ID}x`)).toBeNull();
    expect(recordAt("/today")).toBeNull();
    // A unit opens the directory filtered by a query: not a page of its own.
    expect(recordAt(`/people?departmentId=${ID}`)).toBeNull();
  });
});
