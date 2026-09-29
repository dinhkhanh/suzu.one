// Leave cover for follow-ups (FR-CRM-41). The work module's cover plan (FR-PJM-44) names who covers
// a person's absence; this pass reads the plans that have taken effect and moves the person's open
// follow-ups falling in the absence to the plan's cover — recording whose they were — and hands them
// back once the plan is handed back or its last day has passed. Pulled, not pushed: the work module
// never calls the CRM. Runs each morning before the follow-up reminders, so the cover is reminded.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "../platform/notifications/service";

export async function applyLeaveCover(today: IsoDate): Promise<{ followUpsCovered: number; followUpsHandedBack: number }> {
  return db().transaction(async (tx) => {
    // Back to their owners: follow-ups whose owner's cover has ended (handed back, past its last day, or cancelled).
    const handedBack = await tx.execute(sql`
      update ${schema.crmActivity} set owner_person_id = cover_from_person_id, cover_from_person_id = null, reminded_on = null, updated_at = now()
      where cover_from_person_id is not null and done_at is null
        and not exists (
          select 1 from ${schema.workCoverPlan} p
          where p.person_id = ${schema.crmActivity}.cover_from_person_id and p.status = 'submitted' and p.applied_at is not null
            and p.from_date <= ${today}::date and p.to_date >= ${today}::date and p.default_cover_person_id is not null)
      returning ${schema.crmActivity.id}`);
    // To the cover: the absent person's open follow-ups due during the absence.
    const plans = await tx
      .select({ personId: schema.workCoverPlan.personId, coverId: schema.workCoverPlan.defaultCoverPersonId, fromDate: schema.workCoverPlan.fromDate, toDate: schema.workCoverPlan.toDate, name: schema.person.fullName })
      .from(schema.workCoverPlan)
      .innerJoin(schema.person, eq(schema.person.id, schema.workCoverPlan.personId))
      .where(and(eq(schema.workCoverPlan.status, "submitted"), sql`${schema.workCoverPlan.appliedAt} is not null`, sql`${schema.workCoverPlan.fromDate} <= ${today}::date`, sql`${schema.workCoverPlan.toDate} >= ${today}::date`, sql`${schema.workCoverPlan.defaultCoverPersonId} is not null`));
    let covered = 0;
    for (const plan of plans) {
      const moved = await tx
        .update(schema.crmActivity)
        .set({ ownerPersonId: plan.coverId!, coverFromPersonId: plan.personId, remindedOn: null, updatedAt: new Date() })
        .where(and(eq(schema.crmActivity.ownerPersonId, plan.personId), isNull(schema.crmActivity.doneAt), isNull(schema.crmActivity.coverFromPersonId), sql`${schema.crmActivity.dueOn} between ${plan.fromDate}::date and ${plan.toDate}::date`))
        .returning({ id: schema.crmActivity.id });
      if (moved.length) await notify({ recipients: [plan.coverId!], kind: "crm.cover_followups", params: { count: moved.length, name: plan.name }, link: "/tasks" }, tx);
      covered += moved.length;
    }
    const back = Array.isArray(handedBack) ? handedBack.length : ((handedBack as { rows?: unknown[] }).rows?.length ?? 0);
    return { followUpsCovered: covered, followUpsHandedBack: back };
  });
}
