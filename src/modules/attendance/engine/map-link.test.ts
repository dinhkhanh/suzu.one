import { describe, expect, it } from "vitest";
import { parseMapPoint, roundCoordinate } from "./map-link";

const HQ = { latitude: 10.771595, longitude: 106.704758 };

describe("parseMapPoint (ATT-02)", () => {
  it("reads coordinates as a map app copies them", () => {
    expect(parseMapPoint("10.771595, 106.704758")).toEqual(HQ);
    expect(parseMapPoint(" 10.771595 106.704758 ")).toEqual(HQ);
    expect(parseMapPoint("(10.771595;106.704758)")).toEqual(HQ);
    expect(parseMapPoint("-33.8568, 151.2153")).toEqual({ latitude: -33.8568, longitude: 151.2153 });
  });

  it("reads the place out of a map link, the pin before the view", () => {
    expect(parseMapPoint("https://www.google.com/maps/place/Bitexco/@10.7716,106.7044,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d10.771595!4d106.704758!16s")).toEqual(HQ);
    expect(parseMapPoint("https://www.google.com/maps/@10.771595,106.704758,18z")).toEqual(HQ);
    expect(parseMapPoint("https://maps.google.com/?q=10.771595,106.704758")).toEqual(HQ);
    expect(parseMapPoint("https://www.google.com/maps/search/?api=1&query=10.771595%2C106.704758")).toEqual(HQ);
    expect(parseMapPoint("https://maps.apple.com/?ll=10.771595,106.704758&q=Office")).toEqual(HQ);
    expect(parseMapPoint("https://www.openstreetmap.org/?mlat=10.771595&mlon=106.704758#map=18/10.7700/106.7000")).toEqual(HQ);
    expect(parseMapPoint("https://www.openstreetmap.org/#map=18/10.771595/106.704758")).toEqual(HQ);
  });

  it("finds nothing where there is nothing — a short link, an address, a point off the globe", () => {
    expect(parseMapPoint("https://maps.app.goo.gl/AbCdEf123")).toBeNull();
    expect(parseMapPoint("2 Hải Triều, Bến Nghé, Quận 1")).toBeNull();
    expect(parseMapPoint("12, 7")).toBeNull();
    expect(parseMapPoint("95.1, 106.7")).toBeNull();
    expect(parseMapPoint("0.0, 0.0")).toBeNull();
    expect(parseMapPoint("")).toBeNull();
  });

  it("rounds to six decimals", () => {
    expect(roundCoordinate(10.77159512345)).toBe(10.771595);
  });
});
