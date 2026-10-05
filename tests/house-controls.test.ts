// UI-01: the house rule says no native control where the house kit has one, and no browser
// confirm(). A reading of the screens found dozens back in; this keeps them out. Each exception is
// named with its reason — a new one has to be argued here, not slipped in.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return screens(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

// The kit itself is where the native elements live.
const files = screens(join(root, "src"))
  .map((path) => relative(root, path))
  .filter((path) => !path.startsWith(join("src", "components", "ui")));

const RULES: { name: string; pattern: RegExp; allowed: Record<string, string> }[] = [
  { name: "the browser's confirm()", pattern: /(^|[^.\w])(window\.)?confirm\(/m, allowed: {} },
  { name: "a native checkbox (use Checkbox)", pattern: /<input[^>]*type="checkbox"/, allowed: {} },
  { name: "a native radio (use RadioGroup)", pattern: /<input[^>]*type="radio"/, allowed: {} },
  { name: "a native date input (use DatePicker)", pattern: /<input[^>]*type="(date|datetime-local|month)"/, allowed: {} },
  {
    name: "a raw <textarea> (use Textarea)",
    pattern: /<textarea\b/,
    allowed: {
      "src/modules/platform/rich-text/ui/note-editor.tsx": "the hidden copy the editor posts and the browser validates",
      "src/modules/platform/rich-text/ui/note-editor-impl.tsx": "the same hidden copy, once the editor has loaded",
      "src/modules/ai/ui/chat.tsx": "the assistant's borderless composer inside its own frame",
    },
  },
  {
    name: "a raw <select> (use Select)",
    pattern: /<select\b/,
    allowed: { "src/modules/projects/ui/plan-forms.tsx": "a hidden proxy the assistant's draft button fills" },
  },
  {
    name: "a raw <table> (use Table)",
    pattern: /<table\b/,
    allowed: {
      "src/modules/platform/rich-text/ui/render-doc.tsx": "a table written inside a rich-text document",
      "src/modules/ai/ui/answer-markdown.tsx": "a table written inside the assistant's answer",
    },
  },
];

/** The source without its comments: several of these files explain what they no longer use. */
const code = (path: string) =>
  readFileSync(join(root, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("house controls", () => {
  for (const rule of RULES) {
    it(`no screen uses ${rule.name}`, () => {
      const offenders = files.filter((path) => !(path.split("\\").join("/") in rule.allowed) && rule.pattern.test(code(path)));
      expect(offenders).toEqual([]);
    });
  }
});
