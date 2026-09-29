import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ resolve4: vi.fn(), resolve6: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolve4 = dns.resolve4;
    resolve6 = dns.resolve6;
  },
}));

import { resolveNetworkNames } from "./network-names";

const noRecord = () => Promise.reject(Object.assign(new Error("queryAaaa ENODATA"), { code: "ENODATA" }));

describe("resolveNetworkNames", () => {
  beforeEach(() => {
    dns.resolve4.mockReset();
    dns.resolve6.mockReset().mockImplementation(noRecord);
  });

  it("returns A and AAAA records and reuses them for the DNS TTL, 30 s at most", async () => {
    dns.resolve4.mockResolvedValue([{ address: "192.0.2.44", ttl: 300 }]);
    dns.resolve6.mockResolvedValue([{ address: "2001:db8:7::1", ttl: 10 }]);
    expect(await resolveNetworkNames(["wan1.a.example.com"], 0)).toEqual(new Map([["wan1.a.example.com", ["192.0.2.44", "2001:db8:7::1"]]]));
    await resolveNetworkNames(["wan1.a.example.com"], 9_000);
    expect(dns.resolve4).toHaveBeenCalledTimes(1);
    // The shorter of the two TTLs has run out.
    await resolveNetworkNames(["wan1.a.example.com"], 10_000);
    expect(dns.resolve4).toHaveBeenCalledTimes(2);

    dns.resolve4.mockResolvedValue([{ address: "192.0.2.45", ttl: 3600 }]);
    dns.resolve6.mockImplementation(noRecord);
    await resolveNetworkNames(["wan1.b.example.com"], 0);
    await resolveNetworkNames(["wan1.b.example.com"], 29_000);
    expect(dns.resolve4).toHaveBeenCalledTimes(3);
    expect(await resolveNetworkNames(["wan1.b.example.com"], 30_000)).toEqual(new Map([["wan1.b.example.com", ["192.0.2.45"]]]));
    expect(dns.resolve4).toHaveBeenCalledTimes(4);
  });

  it("maps a name that does not resolve to nothing, and asks again next time", async () => {
    dns.resolve4.mockImplementation(noRecord);
    expect(await resolveNetworkNames(["gone.example.com"], 0)).toEqual(new Map([["gone.example.com", []]]));
    await resolveNetworkNames(["gone.example.com"], 1_000);
    expect(dns.resolve4).toHaveBeenCalledTimes(2);
  });
});
