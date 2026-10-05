// Text the system itself writes into a record that people read later — a leave-ledger line's
// reason, a retro item's — is stored as a message key and its values, not as a sentence in one
// language (UI-01): the screen says it in the reader's language. Pure. Text a person typed is
// stored as typed and comes back unchanged; so does a row written before this existed.
//
// The keys live under the `stored` namespace of messages/*.json. A value may itself be a stored
// message (a cancelled item keeps its first reason), and is said the same way.

const PREFIX = "i18n:";

export type StoredValues = Record<string, string | number>;

/** The text to store for `stored.<key>` with these values. */
export function storedMessage(key: string, values: StoredValues = {}): string {
  return `${PREFIX}${JSON.stringify({ key, values })}`;
}

export function parseStoredMessage(text: string): { key: string; values: StoredValues } | null {
  if (!text.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(PREFIX.length)) as { key?: unknown; values?: unknown };
    if (typeof parsed.key !== "string" || !parsed.values || typeof parsed.values !== "object") return null;
    return { key: parsed.key, values: parsed.values as StoredValues };
  } catch {
    return null;
  }
}

/** A translator over the `stored` namespace — `getTranslations("stored")` on the server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- next-intl types each key's values; these keys are read back from the database.
type StoredTranslator = { (key: any, values?: any): string; has: (key: any) => boolean };

/** Says stored text in the reader's language; anything else comes back as it was. */
export function storedText(text: string, t: StoredTranslator): string;
export function storedText(text: string | null, t: StoredTranslator): string | null;
export function storedText(text: string | null, t: StoredTranslator): string | null {
  if (text === null) return null;
  const message = parseStoredMessage(text);
  if (!message || !t.has(message.key)) return text;
  const values = Object.fromEntries(Object.entries(message.values).map(([name, value]) => [name, typeof value === "string" ? storedText(value, t) : value]));
  return t(message.key, values);
}
