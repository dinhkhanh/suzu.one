// Is this check-in where it should be? (FR-ATT-04.) Pure: no I/O, no clock.
//
// A work location is a circle on the map and/or a list of office networks. Browsers cannot read
// the Wi-Fi name, so the "Wi-Fi rule" is the office's public IP range: whoever is on the office
// network leaves through it. A check-in passes when any one location is satisfied; otherwise it is
// accepted and flagged for review — or refused when every location it could belong to says "block".

export type LocationRule = "gps_or_ip" | "gps" | "ip" | "gps_and_ip";
export type LocationMode = "flag" | "block";

export type WorkLocationRule = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  radiusM: number | null;
  /** A reading less certain than this many metres does not prove anything. */
  accuracyLimitM: number;
  /** CIDR blocks ("203.0.113.0/24", "2001:db8::/32") or single addresses. */
  ipAllowlist: readonly string[];
  rule: LocationRule;
  mode: LocationMode;
  /** Declared for one person and day (an approved off-site request): passing here is still worth a note. */
  offSite?: boolean;
};

export type Position = { latitude: number; longitude: number; accuracyM: number };
export type PunchFlag = "outside_geofence" | "low_accuracy" | "no_position" | "ip_not_allowed" | "off_site_declared";

export type Verdict = {
  outcome: "accepted" | "flagged" | "blocked";
  flags: PunchFlag[];
  locationId: string | null;
  /** Metres to the centre of the matched (or else the nearest) location that has one. */
  distanceM: number | null;
};

const EARTH_RADIUS_M = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── IP addresses ────────────────────────────────────────────────────────────────────────────

function parseIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = BigInt(0);
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << BigInt(8)) | BigInt(part);
  }
  return value;
}

function parseIpv6(text: string): bigint | null {
  let source = text;
  // An embedded IPv4 tail ("::ffff:192.0.2.1") is two groups.
  const tail = source.slice(source.lastIndexOf(":") + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    source = `${source.slice(0, source.lastIndexOf(":") + 1)}${(v4 >> BigInt(16)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  let value = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << BigInt(16)) | BigInt(`0x${group}`);
  }
  return value;
}

export type ParsedIp = { version: 4 | 6; value: bigint };

/** An address as a number. IPv4-mapped IPv6 ("::ffff:10.0.0.1") counts as the IPv4 address it carries. */
export function parseIp(text: string): ParsedIp | null {
  const trimmed = text.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!trimmed) return null;
  if (!trimmed.includes(":")) {
    const value = parseIpv4(trimmed);
    return value === null ? null : { version: 4, value };
  }
  const value = parseIpv6(trimmed);
  if (value === null) return null;
  if (value >> BigInt(32) === BigInt(0xffff)) return { version: 4, value: value & BigInt(0xffffffff) };
  return { version: 6, value };
}

export function parseCidr(text: string): { version: 4 | 6; network: bigint; prefix: number } | null {
  const [address, prefixText, ...extra] = text.trim().split("/");
  if (extra.length) return null;
  const ip = parseIp(address ?? "");
  if (!ip) return null;
  const bits = ip.version === 4 ? 32 : 128;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (prefix > bits) return null;
  const shift = BigInt(bits - prefix);
  return { version: ip.version, network: (ip.value >> shift) << shift, prefix };
}

export function ipInCidr(ipText: string, cidrText: string): boolean {
  const ip = parseIp(ipText);
  const cidr = parseCidr(cidrText);
  if (!ip || !cidr || ip.version !== cidr.version) return false;
  const shift = BigInt((cidr.version === 4 ? 32 : 128) - cidr.prefix);
  return (ip.value >> shift) << shift === cidr.network;
}

export const ipAllowed = (ip: string | null, allowlist: readonly string[]): boolean => !!ip && allowlist.some((cidr) => ipInCidr(ip, cidr));

/** What is wrong with a location as HR typed it. Empty = usable. */
export function locationProblems(location: Pick<WorkLocationRule, "latitude" | "longitude" | "radiusM" | "ipAllowlist" | "rule">): string[] {
  const problems: string[] = [];
  const hasCircle = location.latitude !== null && location.longitude !== null && location.radiusM !== null;
  if ((location.latitude === null) !== (location.longitude === null)) problems.push("location_position_incomplete");
  if (hasCircle && (Math.abs(location.latitude!) > 90 || Math.abs(location.longitude!) > 180)) problems.push("location_position_invalid");
  if (hasCircle && location.radiusM! <= 0) problems.push("location_radius_invalid");
  if (location.ipAllowlist.some((cidr) => !parseCidr(cidr))) problems.push("location_ip_invalid");
  const needsCircle = location.rule === "gps" || location.rule === "gps_and_ip";
  const needsIp = location.rule === "ip" || location.rule === "gps_and_ip";
  if (needsCircle && !hasCircle) problems.push("location_needs_position");
  if (needsIp && location.ipAllowlist.length === 0) problems.push("location_needs_ip");
  if (location.rule === "gps_or_ip" && !hasCircle && location.ipAllowlist.length === 0) problems.push("location_needs_rule");
  return problems;
}

// ── The rule ────────────────────────────────────────────────────────────────────────────────

type Assessment = { location: WorkLocationRule; satisfied: boolean; flags: PunchFlag[]; distanceM: number | null };

function assess(location: WorkLocationRule, position: Position | null, ip: string | null): Assessment {
  const hasCircle = location.latitude !== null && location.longitude !== null && location.radiusM !== null;
  const distanceM = hasCircle && position ? Math.round(haversineM(position, { latitude: location.latitude!, longitude: location.longitude! })) : null;

  const gpsFlags: PunchFlag[] = [];
  let gpsOk = false;
  if (hasCircle) {
    if (!position) gpsFlags.push("no_position");
    else if (position.accuracyM > location.accuracyLimitM) gpsFlags.push("low_accuracy");
    // The true position lies within `accuracy` of the reading: the benefit of the doubt, up to the limit.
    else if (distanceM! - position.accuracyM <= location.radiusM!) gpsOk = true;
    else gpsFlags.push("outside_geofence");
  }
  const ipOk = ipAllowed(ip, location.ipAllowlist);
  const ipFlags: PunchFlag[] = location.ipAllowlist.length > 0 && !ipOk ? ["ip_not_allowed"] : [];

  switch (location.rule) {
    case "gps":
      return { location, satisfied: gpsOk, flags: gpsOk ? [] : gpsFlags, distanceM };
    case "ip":
      return { location, satisfied: ipOk, flags: ipFlags, distanceM };
    case "gps_and_ip":
      return { location, satisfied: gpsOk && ipOk, flags: [...gpsFlags, ...ipFlags], distanceM };
    case "gps_or_ip": {
      const satisfied = gpsOk || ipOk;
      return { location, satisfied, flags: satisfied ? [] : [...gpsFlags, ...ipFlags], distanceM };
    }
  }
}

/**
 * Tests one check-in against the places the person may work from. No locations = nothing to
 * test = accepted. Satisfied somewhere = accepted (the nearest such place is the match). Otherwise
 * the closest place explains what was wrong; the punch is refused only when every place says "block".
 */
export function evaluatePunch(input: { locations: readonly WorkLocationRule[]; position: Position | null; ip: string | null }): Verdict {
  if (input.locations.length === 0) return { outcome: "accepted", flags: [], locationId: null, distanceM: null };
  const byDistance = (a: Assessment, b: Assessment) => (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY);
  const assessed = input.locations.map((location) => assess(location, input.position, input.ip)).sort(byDistance);

  const match = assessed.find((item) => item.satisfied);
  if (match) {
    // Off-site work is where it was declared to be — and still shows up in the review list as such.
    const flags: PunchFlag[] = match.location.offSite ? ["off_site_declared"] : [];
    return { outcome: "accepted", flags, locationId: match.location.id, distanceM: match.distanceM };
  }
  const nearest = assessed[0];
  const blocked = assessed.every((item) => item.location.mode === "block");
  return { outcome: blocked ? "blocked" : "flagged", flags: [...new Set(nearest.flags)], locationId: null, distanceM: nearest.distanceM };
}
