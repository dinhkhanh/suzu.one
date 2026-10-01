// How an amount reads while it is typed: grouped and with a decimal mark in the reader's locale
// ("1.500.000,5" in Vietnamese, "1,500,000.5" in English), and what the form submits for it — the
// plain number, "-1500000.5", whatever the locale. Pure, so `MoneyInput` and its tests share it.

export type Separators = { group: string; decimal: string };

export type AmountOptions = {
  /** Digits allowed after the decimal mark; 0 (whole đồng) drops anything typed after it. */
  decimals?: number;
  /** Whether a leading "-" is kept. */
  allowNegative?: boolean;
};

export type Amount = {
  /** What the field shows: sign, grouped whole part, and the decimal mark and fraction when allowed. */
  display: string;
  /** What the form submits: "" for nothing, otherwise "-?\d+(\.\d+)?" with no grouping. */
  raw: string;
};

/** Past this many whole digits a JavaScript number stops being exact. */
const MAX_DIGITS = 15;

const cache = new Map<string, Separators>();

/** The locale's grouping and decimal marks, as `Intl.NumberFormat` writes them. */
export function separatorsFor(locale: string): Separators {
  const known = cache.get(locale);
  if (known) return known;
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  const separators = { group: parts.find((part) => part.type === "group")?.value ?? ",", decimal: parts.find((part) => part.type === "decimal")?.value ?? "." };
  cache.set(locale, separators);
  return separators;
}

/**
 * Reads what was typed or pasted. The locale's decimal mark is the decimal mark, except when the
 * text carries both "." and "," — an amount copied from somewhere written the other way round — where
 * the later of the two is. Every other non-digit is grouping and is dropped.
 */
export function readAmount(text: string, separators: Separators, options: AmountOptions = {}): Amount {
  const decimals = options.decimals ?? 0;
  const negative = options.allowNegative === true && /^\s*[-−]/.test(text);
  const { mark, at } = decimalMarkOf(text, separators.decimal);
  const hasMark = at >= 0;
  const whole = (hasMark ? text.slice(0, at) : text).replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITS);
  const fraction = hasMark ? text.slice(at + mark.length).replace(/\D/g, "").slice(0, decimals) : "";
  const showMark = hasMark && decimals > 0;
  const shownWhole = whole === "" && showMark ? "0" : group(whole, separators.group);
  const display = (negative ? "-" : "") + shownWhole + (showMark ? separators.decimal + fraction : "");
  if (whole === "" && fraction === "") return { display, raw: "" };
  const zero = /^0*$/.test(whole) && /^0*$/.test(fraction);
  return { display, raw: (negative && !zero ? "-" : "") + (whole || "0") + (fraction ? `.${fraction}` : "") };
}

/** A submitted value ("-1500000.5", 1500000, null) as the field shows it. */
export function formatAmount(value: string | number | null | undefined, separators: Separators, options: AmountOptions = {}): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value.trim();
  if (!/^[-−]?\d*(\.\d*)?$/.test(text)) return readAmount(text, separators, options).display;
  return readAmount(text.replace(".", separators.decimal), separators, options).display;
}

/** An example amount in a placeholder ("60.000.000", "+15.000.000") rewritten in the reader's grouping. */
export function formatPlaceholder(placeholder: string | undefined, separators: Separators): string | undefined {
  const match = placeholder?.match(/^\s*([+\-−]?)\s*(\d[\d.,\s]*)$/);
  if (!match) return placeholder;
  return match[1] + group(match[2].replace(/\D/g, ""), separators.group);
}

/**
 * Where the caret goes after the text is reformatted: past as many digits as stood before it in what
 * was typed (leading zeros and dropped characters aside), and past the decimal mark if that is what
 * was just typed.
 */
export function caretAfter(typed: string, caret: number, display: string, separators: Separators, options: AmountOptions = {}): number {
  const before = readAmount(typed.slice(0, caret), separators, options).display;
  const digits = before.replace(/\D/g, "").length;
  const endsWithMark = (options.decimals ?? 0) > 0 && before.endsWith(separators.decimal);
  let position = display.startsWith("-") && before.startsWith("-") ? 1 : 0;
  let seen = 0;
  for (let index = 0; index < display.length && seen < digits; index += 1) {
    if (/\d/.test(display[index])) {
      seen += 1;
      position = index + 1;
    }
  }
  if (endsWithMark && display.startsWith(separators.decimal, position)) position += separators.decimal.length;
  return Math.min(position, display.length);
}

/** The decimal mark and where it stands: the locale's first, or the later of "." and "," when both appear. */
function decimalMarkOf(text: string, localeMark: string): { mark: string; at: number } {
  const dot = text.lastIndexOf(".");
  const comma = text.lastIndexOf(",");
  if (dot < 0 || comma < 0) return { mark: localeMark, at: text.indexOf(localeMark) };
  return dot > comma ? { mark: ".", at: dot } : { mark: ",", at: comma };
}

function group(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}
