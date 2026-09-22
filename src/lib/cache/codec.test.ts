import { expect, it } from "vitest";
import { decode, encode } from "./codec";

it("keeps Dates as Dates and everything else as JSON", () => {
  const value = { at: new Date("2026-09-22T03:04:05.000Z"), nested: [{ on: new Date(0) }], day: "2026-09-22", count: 3, none: null };
  const back = decode<typeof value>(encode(value));
  expect(back).toEqual(value);
  expect(back.at).toBeInstanceOf(Date);
  expect(back.nested[0].on).toBeInstanceOf(Date);
});
