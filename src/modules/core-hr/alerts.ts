// The daily HR countdowns (FR-CHR-05, FR-CHR-08): contracts running out, probation ending,
// vault documents expiring. Safe to run twice: `hr_alert_sent` remembers what was already said.
import "server-only";
import { and, eq, gt, gte, inArray, isNotNull, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listPeopleHoldingEach } from "@/modules/platform/rbac/service";
import { getParameter } from "@/modules/platform/statutory/service";
import { type AlertSubject, dueAlerts } from "./engine/alert-plan";
import { type ContractType, LABOUR_CONTRACT_TYPES } from "./engine/contract-rules";
import { getPersonTargets } from "./service";

type AlertKind = "hr.contract_expiring" | "hr.probation_ending" | "hr.document_expiring";
type Subject = AlertSubject<AlertKind> & { personId: string; label: string };

// Contracts whose end means someone has to act. An NDA or appendix running out is not a deadline.
const EXPIRING_TYPES: readonly ContractType[] = ["fixed_term", "service", "internship"];

const renewal = alias(schema.contract, "renewal");

/**
 * The contracts whose end may need an alert from `today` on: still running, of a type whose end is
 * a deadline (or a probation), and not yet renewed — a renewal already on file (a later labour
 * contract under the same employment) answers the question the alert would ask. One query; the
 * renewal is an `EXISTS` on the employment's contracts, not a scan of every contract in JavaScript.
 */
export async function contractsToWatch(today: IsoDate): Promise<{ id: string; type: ContractType; endDate: IsoDate; personId: string; number: string }[]> {
  const rows = await db()
    .select({ id: schema.contract.id, type: schema.contract.type, endDate: schema.contract.endDate, personId: schema.contract.personId, number: schema.contract.number })
    .from(schema.contract)
    .where(
      and(
        isNull(schema.contract.deletedAt),
        isNull(schema.contract.terminatedOn),
        isNotNull(schema.contract.endDate),
        gte(schema.contract.endDate, today),
        inArray(schema.contract.type, [...EXPIRING_TYPES, "probation"]),
        notExists(
          db()
            .select({ one: sql`1` })
            .from(renewal)
            .where(
              and(
                eq(renewal.employmentId, schema.contract.employmentId),
                ne(renewal.id, schema.contract.id),
                isNull(renewal.deletedAt),
                inArray(renewal.type, [...LABOUR_CONTRACT_TYPES]),
                gt(renewal.startDate, schema.contract.endDate),
              ),
            ),
        ),
      ),
    );
  return rows.map((row) => ({ ...row, endDate: row.endDate! }));
}

export async function sendHrAlerts(today: IsoDate): Promise<{ contractAlerts: number; probationAlerts: number; documentAlerts: number }> {
  const thresholds = await getParameter("hr.alert_thresholds", today);
  const [contracts, documents] = await Promise.all([
    contractsToWatch(today),
    db().select().from(schema.personDocument).where(and(isNull(schema.personDocument.deletedAt), isNotNull(schema.personDocument.expiresOn), gte(schema.personDocument.expiresOn, today))),
  ]);

  const subjects: Subject[] = [
    ...contracts.map((row) => ({ kind: row.type === "probation" ? ("hr.probation_ending" as const) : ("hr.contract_expiring" as const), subjectId: row.id, dueOn: row.endDate, personId: row.personId, label: row.number })),
    ...documents.map((row) => ({ kind: "hr.document_expiring" as const, subjectId: row.id, dueOn: row.expiresOn!, personId: row.personId, label: row.title })),
  ];
  const due = dueAlerts(today, subjects, { "hr.contract_expiring": thresholds.contractExpiryDays, "hr.probation_ending": thresholds.probationEndDays, "hr.document_expiring": thresholds.documentExpiryDays });

  const tally = { contractAlerts: 0, probationAlerts: 0, documentAlerts: 0 };
  if (due.length === 0) return tally;
  const subjectOf = (alert: (typeof due)[number]) => subjects.find((candidate) => candidate.subjectId === alert.subjectId && candidate.kind === alert.kind)!;
  // Worked out before the transactions, for everybody at once, which then only claim and tell:
  // where each person sits, who in HR holds them, and their name.
  const personIds = [...new Set(due.map((alert) => subjectOf(alert).personId))];
  const [targets, people] = await Promise.all([
    getPersonTargets(personIds),
    db().select({ id: schema.person.id, fullName: schema.person.fullName, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, personIds)),
  ]);
  const placed = personIds.filter((personId) => targets.has(personId));
  // HR, not the owners: a countdown is routine work, and owners who want it can follow the person's page.
  const holders = await listPeopleHoldingEach("person:manage", placed.map((personId) => targets.get(personId)!), { today, includeWildcard: false });
  const hrOf = new Map(placed.map((personId, index) => [personId, holders[index]]));
  const personOf = new Map(people.map((row) => [row.id, row]));

  for (const alert of due) {
    const subject = subjectOf(alert);
    const target = targets.get(subject.personId) ?? null;
    const hr = hrOf.get(subject.personId) ?? [];
    // The line manager plans around a contract or a probation ending. What sits in someone's
    // vault is between them and HR, so document alerts go to the person instead.
    const other = alert.kind === "hr.document_expiring" ? subject.personId : target?.managerId;
    await db().transaction(async (tx) => {
      // The insert is the claim: whoever gets the row sends the alert.
      const [claimed] = await tx.insert(schema.hrAlertSent).values({ kind: alert.kind, subjectId: alert.subjectId, dueOn: alert.dueOn, thresholdDays: alert.thresholdDays }).onConflictDoNothing().returning({ id: schema.hrAlertSent.id });
      if (!claimed) return;
      const person = personOf.get(subject.personId);
      if (!person || person.status === "offboarded") return;
      await notify({ recipients: [...hr, ...(other ? [other] : [])], kind: alert.kind, params: { person: person.fullName, label: subject.label, date: alert.dueOn, days: alert.daysLeft }, link: `/people/${subject.personId}` }, tx);
      tally[alert.kind === "hr.contract_expiring" ? "contractAlerts" : alert.kind === "hr.probation_ending" ? "probationAlerts" : "documentAlerts"]++;
    });
  }
  return tally;
}
