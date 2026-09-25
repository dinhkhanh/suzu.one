// A readable URL or key fragment from any title, Vietnamese included: "Kỹ sư phần mềm (Đà Nẵng)" →
// "ky-su-phan-mem-da-nang". Pure and client-safe, so a form can preview what the server will store.
export function slugify(value: string, { separator = "-", maxLength = 60 }: { separator?: "-" | "_"; maxLength?: number } = {}): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .slice(0, maxLength)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}
