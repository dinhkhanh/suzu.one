import { describe, expect, it } from "vitest";
import { evaluatePunch, haversineM, ipAllowed, ipInCidr, locationProblems, parseCidr, parseIp, type WorkLocationRule } from "./geofence";

// Bitexco tower and two points measured from it.
const OFFICE = { latitude: 10.771595, longitude: 106.704758 };
const north = (metres: number) => ({ latitude: OFFICE.latitude + metres / 111_195, longitude: OFFICE.longitude });

const office = (overrides: Partial<WorkLocationRule> = {}): WorkLocationRule => ({ id: "office", ...OFFICE, radiusM: 150, accuracyLimitM: 100, ipAllowlist: ["203.0.113.0/24", "2001:db8:42::/48"], rule: "gps_or_ip", mode: "flag", ...overrides });

describe("haversineM", () => {
  it("measures known distances", () => {
    expect(haversineM(OFFICE, OFFICE)).toBe(0);
    expect(Math.round(haversineM(OFFICE, north(500)))).toBe(500);
    // Ho Chi Minh City → Hanoi, about 1 140 km in a straight line.
    const km = haversineM({ latitude: 10.7769, longitude: 106.7009 }, { latitude: 21.0278, longitude: 105.8342 }) / 1000;
    expect(km).toBeGreaterThan(1130);
    expect(km).toBeLessThan(1150);
  });
});

describe("IP matching", () => {
  it("parses addresses", () => {
    expect(parseIp("192.0.2.1")).toEqual({ version: 4, value: BigInt(0xc0000201) });
    expect(parseIp("::1")).toEqual({ version: 6, value: BigInt(1) });
    expect(parseIp("::ffff:192.0.2.1")).toEqual({ version: 4, value: BigInt(0xc0000201) });
    expect(parseIp("[2001:db8::1]")?.version).toBe(6);
    expect(parseIp("fe80::1%en0")?.version).toBe(6);
    for (const bad of ["", "256.1.1.1", "1.2.3", "1.2.3.4.5", "2001:::1", "12345::", "1:2:3:4:5:6:7", "hello"]) expect(parseIp(bad)).toBeNull();
  });

  it("parses blocks", () => {
    expect(parseCidr("203.0.113.77/24")).toEqual({ version: 4, network: BigInt(0xcb007100), prefix: 24 });
    expect(parseCidr("127.0.0.1")).toEqual({ version: 4, network: BigInt(0x7f000001), prefix: 32 });
    expect(parseCidr("::1")?.prefix).toBe(128);
    for (const bad of ["203.0.113.0/33", "::/129", "203.0.113.0/x", "203.0.113.0/24/1", "office"]) expect(parseCidr(bad)).toBeNull();
  });

  it("matches inside the block only, and never across versions", () => {
    expect(ipInCidr("203.0.113.5", "203.0.113.0/24")).toBe(true);
    expect(ipInCidr("203.0.114.5", "203.0.113.0/24")).toBe(false);
    expect(ipInCidr("10.1.2.3", "0.0.0.0/0")).toBe(true);
    expect(ipInCidr("2001:db8:42:1::9", "2001:db8:42::/48")).toBe(true);
    expect(ipInCidr("2001:db8:43::9", "2001:db8:42::/48")).toBe(false);
    expect(ipInCidr("::ffff:203.0.113.5", "203.0.113.0/24")).toBe(true);
    expect(ipInCidr("::1", "0.0.0.0/0")).toBe(false);
    expect(ipInCidr("::1", "::1")).toBe(true);
    expect(ipAllowed(null, ["0.0.0.0/0"])).toBe(false);
    expect(ipAllowed("not an ip", ["0.0.0.0/0"])).toBe(false);
  });
});

describe("locationProblems", () => {
  it("accepts usable locations", () => {
    expect(locationProblems(office())).toEqual([]);
    expect(locationProblems(office({ latitude: null, longitude: null, radiusM: null, rule: "ip" }))).toEqual([]);
    expect(locationProblems(office({ ipAllowlist: [], rule: "gps" }))).toEqual([]);
  });
  it("names what is missing or wrong", () => {
    expect(locationProblems(office({ latitude: null }))).toContain("location_position_incomplete");
    expect(locationProblems(office({ latitude: 95 }))).toContain("location_position_invalid");
    expect(locationProblems(office({ radiusM: 0 }))).toContain("location_radius_invalid");
    expect(locationProblems(office({ ipAllowlist: ["10.0.0.0/40"] }))).toContain("location_ip_invalid");
    expect(locationProblems(office({ latitude: null, longitude: null, radiusM: null, rule: "gps" }))).toEqual(["location_needs_position"]);
    expect(locationProblems(office({ ipAllowlist: [], rule: "gps_and_ip" }))).toEqual(["location_needs_ip"]);
    expect(locationProblems(office({ latitude: null, longitude: null, radiusM: null, ipAllowlist: [] }))).toEqual(["location_needs_rule"]);
  });
});

describe("evaluatePunch", () => {
  const at = (metres: number, accuracyM = 10) => ({ ...north(metres), accuracyM });

  it("accepts anything when no location is configured", () => {
    expect(evaluatePunch({ locations: [], position: null, ip: null })).toEqual({ outcome: "accepted", flags: [], locationId: null, distanceM: null });
  });

  it("accepts a reading inside the fence", () => {
    expect(evaluatePunch({ locations: [office()], position: at(80), ip: "198.51.100.1" })).toEqual({ outcome: "accepted", flags: [], locationId: "office", distanceM: 80 });
  });

  it("gives the reading the benefit of its accuracy, up to the limit", () => {
    expect(evaluatePunch({ locations: [office()], position: at(200, 60), ip: null }).outcome).toBe("accepted");
    expect(evaluatePunch({ locations: [office()], position: at(200, 40), ip: null })).toEqual({ outcome: "flagged", flags: ["outside_geofence", "ip_not_allowed"], locationId: null, distanceM: 200 });
    // Too vague to prove anything, even though the circle of doubt reaches the office.
    expect(evaluatePunch({ locations: [office()], position: at(200, 500), ip: null }).flags).toEqual(["low_accuracy", "ip_not_allowed"]);
  });

  it("accepts the office network without a position (gps_or_ip)", () => {
    expect(evaluatePunch({ locations: [office()], position: null, ip: "203.0.113.9" })).toEqual({ outcome: "accepted", flags: [], locationId: "office", distanceM: null });
    expect(evaluatePunch({ locations: [office()], position: null, ip: "2001:db8:42::7" }).outcome).toBe("accepted");
  });

  it("flags a missing position", () => {
    expect(evaluatePunch({ locations: [office()], position: null, ip: "198.51.100.1" })).toEqual({ outcome: "flagged", flags: ["no_position", "ip_not_allowed"], locationId: null, distanceM: null });
    expect(evaluatePunch({ locations: [office({ ipAllowlist: [], rule: "gps" })], position: null, ip: null }).flags).toEqual(["no_position"]);
  });

  it("follows the location's rule", () => {
    const inside = at(20);
    expect(evaluatePunch({ locations: [office({ rule: "gps" })], position: null, ip: "203.0.113.9" }).outcome).toBe("flagged");
    expect(evaluatePunch({ locations: [office({ rule: "ip" })], position: inside, ip: "198.51.100.1" })).toEqual({ outcome: "flagged", flags: ["ip_not_allowed"], locationId: null, distanceM: 20 });
    expect(evaluatePunch({ locations: [office({ rule: "gps_and_ip" })], position: inside, ip: "198.51.100.1" }).flags).toEqual(["ip_not_allowed"]);
    expect(evaluatePunch({ locations: [office({ rule: "gps_and_ip" })], position: at(900), ip: "203.0.113.9" }).flags).toEqual(["outside_geofence"]);
    expect(evaluatePunch({ locations: [office({ rule: "gps_and_ip" })], position: inside, ip: "203.0.113.9" }).outcome).toBe("accepted");
  });

  it("blocks only when every location says block", () => {
    const far = at(5000);
    expect(evaluatePunch({ locations: [office({ mode: "block" })], position: far, ip: null }).outcome).toBe("blocked");
    const studio = office({ id: "studio", latitude: OFFICE.latitude + 0.1, mode: "flag" });
    expect(evaluatePunch({ locations: [office({ mode: "block" }), studio], position: far, ip: null }).outcome).toBe("flagged");
    expect(evaluatePunch({ locations: [office({ mode: "block" })], position: at(10), ip: null }).outcome).toBe("accepted");
  });

  it("matches the nearest satisfied location and reports the nearest when none is", () => {
    const studio = office({ id: "studio", ...north(3000), ipAllowlist: [], rule: "gps" });
    expect(evaluatePunch({ locations: [office(), studio], position: at(2990), ip: null })).toMatchObject({ outcome: "accepted", locationId: "studio", distanceM: 10 });
    expect(evaluatePunch({ locations: [office(), studio], position: at(2000), ip: null })).toMatchObject({ outcome: "flagged", flags: ["outside_geofence"], distanceM: 1000 });
  });

  it("notes a check-in at a declared off-site location", () => {
    const shoot = office({ id: "shoot", ...north(8000), ipAllowlist: [], rule: "gps", offSite: true });
    expect(evaluatePunch({ locations: [office(), shoot], position: at(8020), ip: null })).toEqual({ outcome: "accepted", flags: ["off_site_declared"], locationId: "shoot", distanceM: 20 });
  });
});
