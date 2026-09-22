import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";

export type ShellCounts = { unread: number; inbox: number; openTasks: number; reviews: number; onHiringTeam: boolean; interviewer: boolean };

/**
 * The app frame's badges and recruitment memberships in one round trip (`app.shell_counts`,
 * drizzle/0076). Each figure is what the matching service function would answer on its own.
 */
export async function loadShellCounts(personId: string): Promise<ShellCounts> {
  const [row] = rowsOf<{ unread: number; inbox: number; open_tasks: number; reviews: number; on_hiring_team: boolean; interviewer: boolean }>(await db().execute(sql`select * from app.shell_counts(${personId}::uuid)`));
  return { unread: row?.unread ?? 0, inbox: row?.inbox ?? 0, openTasks: row?.open_tasks ?? 0, reviews: row?.reviews ?? 0, onHiringTeam: !!row?.on_hiring_team, interviewer: !!row?.interviewer };
}
