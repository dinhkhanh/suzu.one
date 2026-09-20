import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFont, type ParsedFont } from "./font";

// The document font, read from disk once per server process and parsed once. See `fonts/README.md`
// for what it is and how to replace it.
//
// The path is spelled out as a literal join from this file's own directory so that Next's output
// tracing sees it and copies the font into the deployment; `next.config.ts` also names it in
// `outputFileTracingIncludes`, because tracing a `readFileSync` is best-effort.
let cached: ParsedFont | undefined;

export function documentFont(): ParsedFont {
  return (cached ??= parseFont(readFileSync(join(process.cwd(), "src/modules/platform/pdf/fonts/Roboto-Subset-Regular.ttf"))));
}

/** The name the payslip and cash-sheet routes have used since Phase 5. */
export const payslipFont = documentFont;
