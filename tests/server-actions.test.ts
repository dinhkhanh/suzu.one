// A `"use server"` file may export nothing but async functions. Export a const, a type alias at
// runtime, a class or a plain value from one and the bundler drops *every* export of the module:
// the page that imports it answers 500, while `tsc`, ESLint and every unit test pass — the exact
// trap the payroll security review found in Phase 5 (docs/PAYROLL_SECURITY_REVIEW.md), and the
// exact trap the request builder fell into again a phase later.
//
// So it is a test. It reads the source, not the bundle: the bundler's own error arrives only when
// somebody opens the page.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "src");

function everySourceFile(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return everySourceFile(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const isUseServer = (source: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["'];/.test(source);

/** `export const x = …`, `export class`, `export let`, `export enum`, `export default <not a function>`. */
const VALUE_EXPORT = /^export\s+(const|let|var|class|enum)\s+/gm;
/** `export function foo` without `async` in front of it. */
const SYNC_FUNCTION_EXPORT = /^export\s+function\s+/gm;

describe('every "use server" file', () => {
  const files = everySourceFile(ROOT)
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) => isUseServer(source));

  it("exists at all (the guard would otherwise be vacuous)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map(({ path, source }) => [path.slice(ROOT.length + 1), source]))("exports only async functions: %s", (_name, source) => {
    expect([...String(source).matchAll(VALUE_EXPORT)].map((match) => match[0].trim())).toEqual([]);
    expect([...String(source).matchAll(SYNC_FUNCTION_EXPORT)].map((match) => match[0].trim())).toEqual([]);
  });
});
