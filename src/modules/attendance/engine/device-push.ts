// What a clock that sends its own punches posts (the face kiosk, tools/face-kiosk). Pure: no I/O.
//
// The body is the canonical device log as JSON. Each moment carries its offset, so the clock's
// zone is never guessed; it comes out as the Vietnam local time every device import uses.
import { z } from "zod";

export const PUSH_BATCH_LIMIT = 500;

// "2026-10-01T08:42:13+07:00" or "…Z"; a moment without an offset is refused.
const instant = z.iso.datetime({ offset: true });

export const pushBodySchema = z.object({
  punches: z
    .array(
      z.object({
        userId: z.string().trim().min(1).max(40),
        at: instant,
        direction: z.enum(["in", "out"]).nullable().optional(),
      }),
    )
    .max(PUSH_BATCH_LIMIT),
});

export type PushBody = z.output<typeof pushBodySchema>;

const VIETNAM_OFFSET_MS = 7 * 3_600_000;

/** An instant → "YYYY-MM-DD HH:mm:ss" on the Vietnam clock, the form device logs are read into. */
export const vietnamLocal = (at: Date): string => new Date(at.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");

export type PushedRow = { row: number; values: { deviceUserId: string; at: string; direction: "in" | "out" | null } };

/** The posted punches as rows of the device log import, numbered from 1 like the lines of a file. */
export function pushedRows(body: PushBody): PushedRow[] {
  return body.punches.map((punch, index) => ({ row: index + 1, values: { deviceUserId: punch.userId, at: vietnamLocal(new Date(punch.at)), direction: punch.direction ?? null } }));
}

/** Rows stamped more than an hour ahead of the server: a clock set wrong. They are refused, not stored. */
export const futureRows = (rows: PushedRow[], now: Date): number[] => rows.filter((row) => Date.parse(`${row.values.at.replace(" ", "T")}+07:00`) > now.getTime() + 3_600_000).map((row) => row.row);
