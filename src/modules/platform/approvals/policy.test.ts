import { describe, expect, it } from "vitest";
import { canWithdraw, withdrawnHere } from "./policy";

describe("canWithdraw", () => {
  it("lets the requester take back a type with no row of its own, until it is decided", () => {
    expect(canWithdraw({ type: "resignation", requesterPersonId: "huy", status: "pending" }, "huy")).toBe(true);
    expect(canWithdraw({ type: "request:expense", requesterPersonId: "huy", status: "returned" }, "huy")).toBe(true);
    expect(canWithdraw({ type: "profile_change", requesterPersonId: "huy", status: "approved" }, "huy")).toBe(false);
    expect(canWithdraw({ type: "resignation", requesterPersonId: "huy", status: "pending" }, "mai")).toBe(false);
  });

  it("refuses the types a module takes back through its own cancel action", () => {
    for (const type of ["leave", "salary_change", "attendance_correction", "offer", "hiring", "kb_publish", "project_change", "project_brief", "something_new"]) {
      expect(withdrawnHere(type)).toBe(false);
      expect(canWithdraw({ type, requesterPersonId: "huy", status: "pending" }, "huy")).toBe(false);
    }
  });
});
