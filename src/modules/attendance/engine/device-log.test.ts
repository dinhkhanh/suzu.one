import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferredDirection, mappingProblems, parseDat, parseTimestamp, PROFILE_SEED, toCanonicalTable } from "./device-log";

const [CSV, ZK] = PROFILE_SEED.map((profile) => profile.mapping);

describe("device log reader (FR-ATT-06)", () => {
  it("reads ZKTeco attlog.dat lines, tab- or space-separated", () => {
    const dat = "       17\t2026-08-03 08:27:31\t1\t0\t1\t0\r\n       17\t2026-08-03 17:35:02\t1\t1\t1\t0\n\n  204 2026-08-03 08:41:10 1 0 1 0\n";
    const { table, headerless } = toCanonicalTable(parseDat(dat), ZK);
    expect(headerless).toBe(true);
    expect(table).toEqual([["Device user ID", "Time", "Direction"], ["17", "2026-08-03 08:27:31", "in"], ["17", "2026-08-03 17:35:02", "out"], ["", "", ""], ["204", "2026-08-03 08:41:10", "in"]]);
  });
  it("finds CSV columns by header, whatever their order and case", () => {
    const { table } = toCanonicalTable([["Name", "STATUS", "time", "user id"], ["Huy", "C/In", "2026-08-03 08:29:00", "5"], ["Huy", "?", "2026-08-03 17:31:00", "5"]], CSV);
    expect(table.slice(1)).toEqual([["5", "2026-08-03 08:29:00", "in"], ["5", "2026-08-03 17:31:00", ""]]);
  });
  it("leaves out the canonical header of a column the file does not have", () => {
    expect(toCanonicalTable([["User ID", "Status"], ["5", "in"]], CSV).table[0]).toEqual(["Device user ID", "", "Direction"]);
  });
  it("passes an unreadable timestamp through so its row gets the problem", () => {
    expect(toCanonicalTable([["User ID", "Time"], ["5", "03/08/2026 8h30"]], CSV).table[1]).toEqual(["5", "03/08/2026 8h30", ""]);
  });
  it("parses timestamps in the profile's format and rejects impossible ones", () => {
    expect(parseTimestamp("3/8/2026 8:05", "DD/MM/YYYY HH:mm")).toBe("2026-08-03 08:05:00");
    expect(parseTimestamp("2026-08-03 08:27:31", "YYYY-MM-DD HH:mm:ss")).toBe("2026-08-03 08:27:31");
    expect(parseTimestamp("31/02/2026 08:00", "DD/MM/YYYY HH:mm")).toBeNull();
    expect(parseTimestamp("2026-08-03 25:00:00", "YYYY-MM-DD HH:mm:ss")).toBeNull();
    expect(parseTimestamp("2026-08-03", "YYYY-MM-DD HH:mm:ss")).toBeNull();
  });
  it("joins a separate time column", () => {
    const mapping = { ...CSV, timestamp: { header: "Date" }, time: { header: "Clock" }, timestampFormat: "DD/MM/YYYY HH:mm" };
    expect(toCanonicalTable([["User ID", "Date", "Clock"], ["9", "03/08/2026", "08:31"]], mapping).table[1]).toEqual(["9", "2026-08-03 08:31:00", ""]);
  });
  it("takes a spreadsheet's date cell as the clock's local reading", () => {
    expect(toCanonicalTable([["User ID", "Time"], [9, new Date(Date.UTC(2026, 7, 3, 8, 31, 5))]], CSV).table[1]).toEqual(["9", "2026-08-03 08:31:05", ""]);
  });
  it("infers in, out, in … and checks a profile", () => {
    expect([0, 1, 2].map((index) => inferredDirection(0, index))).toEqual(["in", "out", "in"]);
    expect(inferredDirection(1, 0)).toBe("out");
    expect(mappingProblems(ZK)).toEqual([]);
    expect(mappingProblems({ ...ZK, userId: {}, timestampFormat: "DD/MM" })).toEqual(["mapping_user_column", "mapping_format"]);
  });

  it("reads the demo exports under scripts/fixtures without a problem", () => {
    const dat = toCanonicalTable(parseDat(readFileSync("scripts/fixtures/attlog-szm.dat", "utf8")), ZK).table.slice(1);
    expect(dat.length).toBeGreaterThan(50);
    expect(dat.every(([id, time, direction]) => /^\d+$/.test(id) && /^2026-09-1\d \d{2}:\d{2}:\d{2}$/.test(time) && (direction === "in" || direction === "out"))).toBe(true);
    expect(dat.some(([id]) => id === "250")).toBe(true);
    const csv = readFileSync("scripts/fixtures/device-log-szg.csv", "utf8").trim().split("\n").map((line) => line.split(","));
    expect(toCanonicalTable(csv, CSV).table.slice(1).every(([id, time, direction]) => id !== "" && time.length === 19 && direction !== "")).toBe(true);
  });
});
