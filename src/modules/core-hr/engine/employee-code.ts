// Per-entity employee numbering (FR-CHR-03): prefix + zero-padded counter. Pure.
export type CodeScheme = { prefix: string; padding: number };

export function defaultCodeScheme(entityCode: string): CodeScheme {
  return { prefix: `${entityCode}-`, padding: 4 };
}

export function formatEmployeeCode(scheme: CodeScheme, number: number): string {
  return `${scheme.prefix}${String(number).padStart(scheme.padding, "0")}`;
}

// Codes typed by HR (existing staff keep their old codes) are compared case-insensitively.
export function normalizeEmployeeCode(code: string): string {
  return code.trim().toUpperCase();
}
