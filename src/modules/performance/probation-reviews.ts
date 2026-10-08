// Probation reviews from probation contracts (FR-PRF-03). A probation cycle is **rolling**: HR
// builds and launches it once (per entity, or for the whole group), and every morning the people
// whose probation contract is about to end are put into it, each with deadlines of their own
// (`engine/probation.ts`). Their review is released as soon as it is in — nobody waits for a cohort.
//
// One probation is enrolled once: the claim is a `performance_reminder_sent` row keyed by the
// contract, written in the same transaction as the participant. So a person HR took out of the
// cycle by hand is not put back the next morning, and a second run of the job adds nobody twice.
import "server-only";
import { and, eq } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { listProbationsEnding } from "@/modules/core-hr/service";
import { getParameter } from "@/modules/platform/statutory/service";
import { probationLookahead, probationReviewDates } from "./engine/probation";
import { loadDirectory } from "./people";
import { type Enrolled, enrolledOf, type ReviewCycleRow } from "./reviews";

/** The claim's kind in `performance_reminder_sent`: this probation contract has been enrolled. */
export const PROBATION_ENROLLED = "probation_enrolled";

/**
 * Put everybody whose probation ends within the countdown into the open rolling probation cycle
 * that covers them — their entity's if it has one, else the group's — and hand back who was put in,
 * for the notices. Collaborators and people no longer active are left out, as at any launch.
 */
export async function enrolProbationReviews(today: IsoDate, executor: ReturnType<typeof db> = db()): Promise<Enrolled[]> {
  const cycles = await executor
    .select()
    .from(schema.reviewCycle)
    .where(and(eq(schema.reviewCycle.isRolling, true), eq(schema.reviewCycle.kind, "probation"), eq(schema.reviewCycle.status, "active")));
  if (cycles.length === 0) return [];
  const { probationEndDays } = await getParameter("hr.alert_thresholds", today);
  const [endings, directory] = await Promise.all([listProbationsEnding({ from: today, to: addDays(today, probationLookahead(probationEndDays)) }, executor), loadDirectory(executor)]);

  const covers = (cycle: ReviewCycleRow, lastDay: IsoDate) => cycle.periodStart <= lastDay && lastDay <= cycle.periodEnd;
  const planned = endings.flatMap((ending) => {
    const person = directory.get(ending.personId);
    if (!person || person.status !== "active" || person.workforceType === "collaborator") return [];
    const cycle = cycles.find((row) => row.entityId === ending.entityId && covers(row, ending.endDate)) ?? cycles.find((row) => row.entityId === null && covers(row, ending.endDate));
    if (!cycle) return [];
    const dates = probationReviewDates(ending.endDate, probationEndDays, today);
    return [
      {
        contractId: ending.contractId,
        cycle,
        row: {
          cycleId: cycle.id,
          personId: person.personId,
          entityId: person.entityId ?? ending.entityId,
          departmentId: person.departmentId,
          managerPersonId: person.managerId ?? null,
          selfDueOn: dates.selfDueOn,
          managerDueOn: dates.managerDueOn,
        },
      },
    ];
  });
  if (planned.length === 0) return [];

  return executor.transaction(async (tx) => {
    const claimed = await tx
      .insert(schema.performanceReminderSent)
      .values(planned.map((plan) => ({ personId: plan.row.personId, kind: PROBATION_ENROLLED, subject: plan.contractId, sentOn: today })))
      .onConflictDoNothing()
      .returning({ subject: schema.performanceReminderSent.subject });
    const fresh = new Set(claimed.map((row) => row.subject));
    const rows = planned.filter((plan) => fresh.has(plan.contractId)).map((plan) => plan.row);
    if (rows.length === 0) return [];
    // Somebody HR already put in by hand keeps the deadlines HR gave them.
    const inserted = await tx.insert(schema.reviewParticipant).values(rows).onConflictDoNothing().returning();
    return inserted.map((participant) =>
      enrolledOf(
        participant,
        cycles.find((cycle) => cycle.id === participant.cycleId)!,
      ),
    );
  });
}
