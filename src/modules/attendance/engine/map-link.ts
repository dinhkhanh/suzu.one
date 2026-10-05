// Where on the map a pasted text points (ATT-02). Pure: no I/O.
//
// Nobody types a latitude. They find the place in a map app and copy what it gives them: the
// coordinates themselves ("10.7716, 106.7048"), or the link from the address bar. A link carries
// the place in one of a few known shapes — Google's pin (`!3d…!4d…`) and its view (`@lat,lng,17z`),
// a query (`?q=lat,lng`, `ll=`, `query=`, `destination=`), OpenStreetMap's marker (`mlat=…&mlon=…`)
// and view (`#map=17/lat/lng`). A short share link ("maps.app.goo.gl/…") carries none: it is a
// redirect, and following it would mean fetching someone else's site.

export type MapPoint = { latitude: number; longitude: number };

const NUMBER = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

// Most specific first: a Google link carries the pin and, separately, wherever the view was centred.
const SHAPES: readonly RegExp[] = [
  new RegExp(String.raw`!3d${NUMBER}!4d${NUMBER}`),
  new RegExp(String.raw`[?&]mlat=${NUMBER}&mlon=${NUMBER}`, "i"),
  new RegExp(String.raw`[?&](?:q|ll|sll|query|destination|center|daddr)=(?:loc:)?${NUMBER}(?:,|%2C)\s*(?:\+|%20)?${NUMBER}`, "i"),
  new RegExp(String.raw`@${NUMBER},${NUMBER}`),
  new RegExp(String.raw`#map=\d{1,2}(?:\.\d+)?/${NUMBER}/${NUMBER}`),
];

// Plain coordinates: "10.7716, 106.7048", "10.7716 106.7048", "10.7716;106.7048". Decimals required,
// so a street number and a ward ("12, 7") are never read as a place.
const PLAIN = /^\s*\(?\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*\)?\s*$/;

const valid = (latitude: number, longitude: number): MapPoint | null =>
  Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0) ? { latitude, longitude } : null;

/** The point in a pasted text, or null when the text holds none. */
export function parseMapPoint(text: string): MapPoint | null {
  const plain = PLAIN.exec(text);
  if (plain) return valid(Number(plain[1]), Number(plain[2]));
  for (const shape of SHAPES) {
    const match = shape.exec(text);
    if (match) {
      const point = valid(Number(match[1]), Number(match[2]));
      if (point) return point;
    }
  }
  return null;
}

/** Six decimals is about ten centimetres: more than any phone knows, less than a form needs to show. */
export const roundCoordinate = (value: number): number => Math.round(value * 1e6) / 1e6;
