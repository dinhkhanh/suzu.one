// The daily HR countdowns (FR-CHR-05, FR-CHR-08): contracts running out, probation ending,
// vault documents expiring. Safe to run twice: `hr_alert_sent` remembers what was already said.
import "server-only";
import { and, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import { getParameter } from "@/modules/platform/statutory/service";
import { type AlertSubject, dueAlerts } from "./engine/alert-plan";
import { isLabourContract } from "./engine/contract-rules";
import { getPersonTarget } from "./service";

type AlertKind = "hr.contract_expiring" | "hr.probation_ending" | "hr.document_expiring";
type Subject = AlertSubject<AlertKind> & { personId: string; label: string };

// Contracts whose end means someone has to act. An NDA or appendix running out is not a deadline.
const EXPIRING_TYPES = ["fixed_term", "service", "internship"];

export async function sendHrAlerts(today: IsoDate): Promise<{ contractAlerts: number; probationAlerts: number; documentAlerts: number }> {
  const thresholds = await getParameter("hr.alert_thresholds", today);
  const [contracts, documents] = await Promise.all([
    db().select().from(schema.contract).where(and(isNull(schema.contract.deletedAt), isNull(schema.contract.terminatedOn), isNotNull(schema.contract.endDate), gte(schema.contract.endDate, today))),
    db().select().from(schema.personDocument).where(and(isNull(schema.personDocument.deletedAt), isNotNull(schema.personDocument.expiresOn), gte(schema.personDocument.expiresOn, today))),
  ]);
  // A renewal that is already on file answers the question the alert would ask.
  const everyContract = contracts.length ? await db().select().from(schema.contract).where(isNull(schema.contract.deletedAt)) : [];
  const renewed = (contract: (typeof contracts)[number]) => everyContract.some((other) => other.employmentId === contract.employmentId && other.id !== contract.id && isLabourContract(other.type) && other.startDate > contract.endDate!);

  const subjects: Subject[] = [
    ...contracts.filter((row) => (EXPIRING_TYPES.includes(row.type) || row.type === "probation") && !renewed(row)).map((row) => ({ kind: row.type === "probation" ? ("hr.probation_ending" as const) : ("hr.contract_expiring" as const), subjectId: row.id, dueOn: row.endDate!, personId: row.personId, label: row.number })),
    ...documents.map((row) => ({ kind: "hr.document_expiring" as const, subjectId: row.id, dueOn: row.expiresOn!, personId: row.personId, label: row.title })),
  ];
  const due = dueAlerts(today, subjects, { "hr.contract_expiring": thresholds.contractExpiryDays, "hr.probation_ending": thresholds.probationEndDays, "hr.document_expiring": thresholds.documentExpiryDays });

  const tally = { contractAlerts: 0, probationAlerts: 0, documentAlerts: 0 };
  for (const alert of due) {
    const subject = subjects.find((candidate) => candidate.subjectId === alert.subjectId && candidate.kind === alert.kind)!;
    // Worked out before the transaction, which then only claims and tells.
    const target = await getPersonTarget(subject.personId);
    // HR, not the owners: a countdown is routine work, and owners who want it can follow the person's page.
    const hr = target ? await listPeopleHolding("person:manage", target, { today, includeWildcard: false }) : [];
    // The line manager plans around a contract or a probation ending. What sits in someone's
    // vault is between them and HR, so document alerts go to the person instead.
    const other = alert.kind === "hr.document_expiring" ? subject.personId : target?.managerId;
    await db().transaction(async (tx) => {
      // The insert is the claim: whoever gets the row sends the alert.
      const [claimed] = await tx.insert(schema.hrAlertSent).values({ kind: alert.kind, subjectId: alert.subjectId, dueOn: alert.dueOn, thresholdDays: alert.thresholdDays }).onConflictDoNothing().returning({ id: schema.hrAlertSent.id });
      if (!claimed) return;
      const [person] = await tx.select({ fullName: schema.person.fullName, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, subject.personId)).limit(1);
      if (!person || person.status === "offboarded") return;
      await notify({ recipients: [...hr, ...(other ? [other] : [])], kind: alert.kind, params: { person: person.fullName, label: subject.label, date: alert.dueOn, days: alert.daysLeft }, link: `/people/${subject.personId}` }, tx);
      tally[alert.kind === "hr.contract_expiring" ? "contractAlerts" : alert.kind === "hr.probation_ending" ? "probationAlerts" : "documentAlerts"]++;
    });
  }
  return tally;
}
