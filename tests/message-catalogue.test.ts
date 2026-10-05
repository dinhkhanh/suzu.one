// The message catalogues are edited by hand, and JSON.parse keeps the last of two equal keys
// without a word — so a duplicate hides whichever text was written first. This reads the files as
// text and refuses a key that appears twice in one object.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every "path.to.key" that appears more than once in the same object. */
function duplicateKeys(source: string): string[] {
  let at = 0;
  const found: string[] = [];
  const space = () => {
    while (/\s/.test(source[at] ?? "")) at++;
  };
  const string = (): string => {
    const start = at;
    at++;
    while (source[at] !== '"') at += source[at] === "\\" ? 2 : 1;
    at++;
    return JSON.parse(source.slice(start, at)) as string;
  };
  const value = (path: string): void => {
    space();
    if (source[at] === "{") return object(path);
    if (source[at] === "[") {
      at++;
      for (let index = 0; ; index++) {
        space();
        if (source[at] === "]") return void at++;
        value(`${path}[${index}]`);
        space();
        if (source[at] === ",") at++;
      }
    }
    if (source[at] === '"') return void string();
    while (!/[,}\]\s]/.test(source[at] ?? ",")) at++;
  };
  const object = (path: string): void => {
    at++;
    const keys = new Set<string>();
    for (;;) {
      space();
      if (source[at] === "}") return void at++;
      const key = string();
      const full = path ? `${path}.${key}` : key;
      if (keys.has(key)) found.push(full);
      keys.add(key);
      space();
      at++; // the colon
      value(full);
      space();
      if (source[at] === ",") at++;
    }
  };
  value("");
  return found;
}

describe("message catalogues", () => {
  it("finds a duplicate key, nested or not", () => {
    expect(duplicateKeys('{"a": {"b": "1", "c": [1, {"d": 2}], "b": "2"}, "e": "x\\"y"}')).toEqual(["a.b"]);
  });

  for (const locale of ["vi", "en"]) {
    it(`${locale}.json has no key twice in one object`, () => {
      expect(duplicateKeys(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"))).toEqual([]);
    });
  }
});
