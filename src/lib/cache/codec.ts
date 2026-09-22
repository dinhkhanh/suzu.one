// JSON that survives the round trip through Redis with its Dates intact (Drizzle returns
// timestamps as Date objects; plain JSON would hand them back as strings).

const DATE = "$date";

export function encode(value: unknown): string {
  return JSON.stringify(value, function (key, raw) {
    const original = (this as Record<string, unknown>)[key];
    return original instanceof Date ? { [DATE]: original.toISOString() } : raw;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, value) => (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value[DATE] === "string" ? new Date(value[DATE]) : value)) as T;
}
