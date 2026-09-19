// Accent-stripped, lower-cased key for searching Vietnamese names ("Nguyễn Thị Đào" → "nguyen thi dao").
export function toSearchKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
