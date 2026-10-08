// Accent-stripped, lower-cased key for searching Vietnamese names ("Nguyễn Thị Đào" → "nguyen thi dao").
export function toSearchKey(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A name with every word capitalised and single-spaced: "problem  solving" → "Problem Solving",
 * "thuyết trình" → "Thuyết Trình", "ui/ux" → "Ui/Ux". Only the first letter of a word is touched,
 * so what was typed in capitals stays — "SEO", "B2B marketing" → "B2B Marketing".
 */
export function capitalizeWords(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s/\-(&+])(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

// Two letters for a picture-less avatar. Vietnamese names end with the given name, so the last two
// words: "Nguyễn Thị Đào" → "TĐ".
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}
