import { describe, expect, it } from "vitest";
import { isEnabled, OFF } from "./flags";

const huy = { personId: "huy", entityId: "media", departmentId: "video" };

describe("isEnabled", () => {
  it("is off when nothing says otherwise", () => {
    expect(isEnabled(undefined, huy)).toBe(false);
    expect(isEnabled(OFF, huy)).toBe(false);
  });

  it("turns on for everyone, or for a person's entity, department or the person", () => {
    expect(isEnabled({ ...OFF, enabledForAll: true }, { personId: null, entityId: null, departmentId: null })).toBe(true);
    expect(isEnabled({ ...OFF, entityIds: ["media"] }, huy)).toBe(true);
    expect(isEnabled({ ...OFF, departmentIds: ["video"] }, huy)).toBe(true);
    expect(isEnabled({ ...OFF, personIds: ["huy"] }, huy)).toBe(true);
    expect(isEnabled({ ...OFF, entityIds: ["creative"], departmentIds: ["design"], personIds: ["chi"] }, huy)).toBe(false);
  });

  it("never matches on missing placement", () => {
    expect(isEnabled({ ...OFF, entityIds: [""] }, { personId: null, entityId: null, departmentId: null })).toBe(false);
  });
});
