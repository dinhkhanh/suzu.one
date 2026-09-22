import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";

export type ShellCounts = {
  unread: number;
  inbox: number;
  openTasks: number;
  /** Versions waiting for this person's decision: single-step reviews and chain stages (FR-PJM-50). */
  reviews: number;
  /** Hand-offs waiting for this person to accept or return (FR-PJM-40). */
  handoffs: number;
  /** Open blockers waiting on this person (FR-PJM-28). */
  blockers: number;
  onHiringTeam: boolean;
  interviewer: boolean;
};

/**
 * The app frame's badges and recruitment memberships in one round trip (`app.shell_counts`,
 * drizzle/0085). Each figure is what the matching service function would answer on its own.
 */
export async function loadShellCounts(personId: string): Promise<ShellCounts> {
  const [row] = rowsOf<{ unread: number; inbox: number; open_tasks: number; reviews: number; handoffs: number; blockers: number; on_hiring_team: boolean; interviewer: boolean }>(await db().execute(sql`select * from app.shell_counts(${personId}::uuid)`));
  return { unread: row?.unread ?? 0, inbox: row?.inbox ?? 0, openTasks: row?.open_tasks ?? 0, reviews: row?.reviews ?? 0, handoffs: row?.handoffs ?? 0, blockers: row?.blockers ?? 0, onHiringTeam: !!row?.on_hiring_team, interviewer: !!row?.interviewer };
}
