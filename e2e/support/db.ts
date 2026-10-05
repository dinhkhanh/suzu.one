// The suite's own line to the database: to sign people in (session rows) and to read back what a
// journey did. Direct, not through the pooler — the app under test is the one that goes through it.
//
// Refuses anything but a throwaway database on this machine, which the caller must also vouch for
// (`E2E_THROWAWAY_DATABASE=1`, set by the CI job beside the service container it created).
import postgres from "postgres";

let client: postgres.Sql | undefined;

export function databaseUrl(): string {
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) throw new Error("e2e: POSTGRES_URL_NON_POOLING (or POSTGRES_URL) is not set");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`e2e: refusing to run against ${host} — only a throwaway database on this machine`);
  if (process.env.E2E_THROWAWAY_DATABASE !== "1") throw new Error("e2e: set E2E_THROWAWAY_DATABASE=1 to confirm the database may be written to and thrown away");
  return url;
}

export function sql(): postgres.Sql {
  return (client ??= postgres(databaseUrl(), { max: 2, prepare: false, onnotice: () => undefined }));
}

export async function closeSql(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = undefined;
}
