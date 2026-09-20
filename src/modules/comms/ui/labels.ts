import { parseAudienceKey } from "../enums";

/** "entity:<id>" → "Pháp nhân: Media". `t` is the `comms` translator. */
export function audienceLabel(key: string, names: ReadonlyMap<string, string>, t: (key: string) => string): string {
  const subject = parseAudienceKey(key);
  if (!subject) return key;
  return subject.type === "all" ? t("audience.all") : `${t(`audience.${subject.type}`)}: ${names.get(key) ?? "?"}`;
}

/** A Date as the value of <input type="datetime-local">, on Vietnam's clock. */
export const toLocalInput = (date: Date | null): string => (date ? new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 16) : "");
