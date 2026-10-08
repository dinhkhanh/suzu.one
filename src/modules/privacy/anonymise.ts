// Former employees past their retention period (NFR-PRV-04): the list HR works from, and the
// anonymisation HR confirms one person at a time. **Never automatic, and never a delete**: the
// nightly jobs only clear what was always temporary (`retention.ts`); a person's record is emptied
// only when somebody in HR has looked at it and said so.
//
// What goes — personal details the company no longer needs once the employment can no longer be
// argued over (`FORMER_EMPLOYEE_RETENTION_YEARS`):
//   · the work mailbox on the person and their app account (Better Auth's user, its sessions and
//     its Google link) — the address is also how they would sign in;
//   · the profile picture, its bytes removed from storage at once;
//   · from the profile: phone, personal email, current address, marital status;
//   · the emergency contacts — other people's numbers, kept for a reason that has ended;
//   · the vault's ID scans, health checks, diplomas, certificates and "other" papers (rows hidden,
//     bytes removed at once);
//   · their inbox, notification settings and web-push devices; Messenger and Telegram links
//     revoked and their chat ids blanked;
//   · their conversations with the assistant and the questions it logged;
//   · their face templates, if any are left; and the position, network address and browser of
//     every check-in they made from the app.
//
// What stays, and why — the records accounting, tax, insurance and labour law require the company
// to keep (Accounting Law 2015 art. 41, Decree 174/2016 art. 12: ten years), which must still say
// whom they are about: the name and employee code, date of birth, gender, nationality and permanent
// address (what tax and insurance forms identify a person by), the identity, tax, social-insurance
// and bank numbers, the dependants claimed for PIT, employment periods and assignments, contracts and
// decisions with their signed copies, lifecycle events, payroll runs, payslips and payments,
// timesheets and punches (times and verdicts), leave, approval requests, issued documents, and the
// consent record itself. The audit log is append-only and is not touched.
import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { invalidateLive } from "@/lib/cache/live";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { invalidateSessionTokens } from "@/modules/platform/auth/session-cache";
import { eraseFiles } from "@/modules/platform/files/service";
import { invalidatePeople } from "@/modules/platform/people/service";
import { permissionReach, type Principal, reachesNothing } from "@/modules/platform/rbac/policy";
import { personInReachSql } from "@/modules/platform/rbac/reach-sql";
import { anonymisationDueOn, FORMER_EMPLOYEE_RETENTION_YEARS } from "./engine/retention";
import { PUNCH_POSITION_FIELDS } from "./retention";

/** Vault categories that are about the person rather than the employment: they go. Contracts and decisions stay. */
export const ERASED_DOCUMENT_CATEGORIES = ["id_scan", "health_check", "degree", "certificate", "other"] as const;

export type DueRow = { personId: string; fullName: string; employeeCode: string | null; entity: string | null; lastDay: IsoDate; dueOn: IsoDate };

/**
 * The former employees whose retention period has passed and who are not anonymised yet, among the
 * people the viewer keeps records of (`person:manage`), longest overdue first. Decided in SQL: the
 * last day is the latest end of their employments, and nobody with an open employment is due.
 */
export async function listAnonymisationDue(principal: Principal, today: IsoDate, years: number = FORMER_EMPLOYEE_RETENTION_YEARS): Promise<DueRow[]> {
  const reach = permissionReach(principal, "person:manage");
  // No grant at all adds no condition to the query: answered here, before it would read everyone.
  if (reachesNothing(reach)) return [];
  const lastDay = sql<string>`max(${schema.employment.endDate})::text`;
  const rows = await db()
    .select({
      personId: schema.person.id,
      fullName: schema.person.fullName,
      employeeCode: sql<string | null>`(array_agg(${schema.employment.employeeCode} order by ${schema.employment.endDate} desc))[1]`,
      entity: schema.entity.shortName,
      lastDay,
    })
    .from(schema.person)
    .innerJoin(schema.employment, eq(schema.employment.personId, schema.person.id))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.person.primaryEntityId))
    .leftJoin(schema.personAnonymisation, eq(schema.personAnonymisation.personId, schema.person.id))
    .where(and(eq(schema.person.status, "offboarded"), isNull(schema.personAnonymisation.personId), personInReachSql(reach)))
    .groupBy(schema.person.id, schema.person.fullName, schema.entity.shortName)
    // `date + interval` lands on the last day of a short month, as `anonymisationDueOn` does.
    .having(sql`bool_and(${schema.employment.endDate} is not null) and (max(${schema.employment.endDate}) + make_interval(years => ${years}::int))::date < ${today}::date`)
    .orderBy(asc(sql`max(${schema.employment.endDate})`), asc(schema.person.fullName));
  return rows.map((row) => ({ ...row, lastDay: row.lastDay as IsoDate, dueOn: anonymisationDueOn(row.lastDay as IsoDate, years) }));
}

export type AnonymisationResult = { lastDay: IsoDate; removed: Record<string, number> };

/**
 * Empties one former employee's personal details (see the top of the file), once, inside one
 * transaction; the files' bytes and the caches go after it commits. Refused unless the person has
 * left, has no open employment, is past `FORMER_EMPLOYEE_RETENTION_YEARS`, and is not done already.
 */
export async function anonymiseFormerEmployee(personId: string, actorPersonId: string, today: IsoDate, now: Date = new Date()): Promise<AnonymisationResult> {
  if (personId === actorPersonId) throw new ActionError("anonymise_self");
  const outcome = await db().transaction(async (tx) => {
    const [person] = await tx.select().from(schema.person).where(eq(schema.person.id, personId)).limit(1).for("update");
    if (!person) throw new ActionError("person_not_found");
    const [done] = await tx.select({ personId: schema.personAnonymisation.personId }).from(schema.personAnonymisation).where(eq(schema.personAnonymisation.personId, personId)).limit(1);
    if (done) throw new ActionError("already_anonymised");
    const [period] = await tx
      .select({ lastDay: sql<string | null>`max(${schema.employment.endDate})::text`, open: sql<number>`count(*) filter (where ${schema.employment.endDate} is null)::int` })
      .from(schema.employment)
      .where(eq(schema.employment.personId, personId));
    if (person.status !== "offboarded" || !period?.lastDay || period.open > 0) throw new ActionError("not_former_employee");
    const lastDay = period.lastDay as IsoDate;
    if (anonymisationDueOn(lastDay) > today) throw new ActionError("retention_not_over", { dueOn: anonymisationDueOn(lastDay) });

    // What storage must lose: the picture, and the papers that are about the person rather than the job.
    const documents = await tx
      .select({ id: schema.personDocument.id, fileId: schema.personDocument.fileId })
      .from(schema.personDocument)
      .where(and(eq(schema.personDocument.personId, personId), inArray(schema.personDocument.category, [...ERASED_DOCUMENT_CATEGORIES])));
    const fileIds = [...documents.map((row) => row.fileId), ...(person.photoFileId ? [person.photoFileId] : [])];
    const users = person.workEmail
      ? await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(sql`lower(${schema.user.email}) = ${person.workEmail}`)
      : [];
    const sessions = users.length
      ? await tx
          .select({ token: schema.session.token })
          .from(schema.session)
          .where(
            inArray(
              schema.session.userId,
              users.map((row) => row.id),
            ),
          )
      : [];

    const count = (rows: readonly unknown[]) => rows.length;
    await tx.update(schema.person).set({ workEmail: null, photoFileId: null, updatedAt: now }).where(eq(schema.person.id, personId));
    await tx.update(schema.personProfile).set({ phone: null, personalEmail: null, currentAddress: null, maritalStatus: null, updatedAt: now }).where(eq(schema.personProfile.personId, personId));
    if (documents.length)
      await tx
        .update(schema.personDocument)
        .set({ deletedAt: now })
        .where(
          and(
            inArray(
              schema.personDocument.id,
              documents.map((row) => row.id),
            ),
            isNull(schema.personDocument.deletedAt),
          ),
        );
    const removed: Record<string, number> = {
      emergencyContacts: count(await tx.delete(schema.emergencyContact).where(eq(schema.emergencyContact.personId, personId)).returning({ id: schema.emergencyContact.id })),
      documents: documents.length,
      photo: person.photoFileId ? 1 : 0,
      notifications: count(await tx.delete(schema.notification).where(eq(schema.notification.recipientPersonId, personId)).returning({ id: schema.notification.id })),
      notificationSettings: count(await tx.delete(schema.notificationPreference).where(eq(schema.notificationPreference.personId, personId)).returning({ personId: schema.notificationPreference.personId })),
      pushDevices: count(await tx.delete(schema.pushSubscription).where(eq(schema.pushSubscription.personId, personId)).returning({ id: schema.pushSubscription.id })),
      messengerLinks: count(
        await tx
          .update(schema.messengerLink)
          .set({ psid: "", revokedAt: sql`coalesce(${schema.messengerLink.revokedAt}, now())`, revokedReason: sql`coalesce(${schema.messengerLink.revokedReason}, 'anonymised')` })
          .where(eq(schema.messengerLink.personId, personId))
          .returning({ id: schema.messengerLink.id }),
      ),
      telegramLinks: count(
        await tx
          .update(schema.telegramLink)
          .set({ chatId: "", revokedAt: sql`coalesce(${schema.telegramLink.revokedAt}, now())`, revokedReason: sql`coalesce(${schema.telegramLink.revokedReason}, 'anonymised')` })
          .where(eq(schema.telegramLink.personId, personId))
          .returning({ id: schema.telegramLink.id }),
      ),
      conversations: count(await tx.delete(schema.aiConversation).where(eq(schema.aiConversation.personId, personId)).returning({ id: schema.aiConversation.id })),
      unansweredQuestions: count(await tx.delete(schema.aiUnansweredQuestion).where(eq(schema.aiUnansweredQuestion.personId, personId)).returning({ id: schema.aiUnansweredQuestion.id })),
      faceTemplates: count(await tx.delete(schema.faceEnrolment).where(eq(schema.faceEnrolment.personId, personId)).returning({ personId: schema.faceEnrolment.personId })),
      punchPositions: count(
        await tx
          .update(schema.punch)
          .set(PUNCH_POSITION_FIELDS)
          .where(
            and(
              eq(schema.punch.personId, personId),
              sql`${schema.punch.source} = 'app'`,
              or(sql`${schema.punch.latitude} is not null`, sql`${schema.punch.ipAddress} is not null`, sql`${schema.punch.userAgent} is not null`, sql`${schema.punch.deviceInfo} is not null`),
            ),
          )
          .returning({ id: schema.punch.id }),
      ),
      // Sessions and the Google link go with the account (on delete cascade).
      accounts: users.length
        ? count(
            await tx
              .delete(schema.user)
              .where(
                inArray(
                  schema.user.id,
                  users.map((row) => row.id),
                ),
              )
              .returning({ id: schema.user.id }),
          )
        : 0,
    };
    await tx.insert(schema.personAnonymisation).values({ personId, lastDay, anonymisedAt: now, anonymisedByPersonId: actorPersonId, removed });
    return { person, lastDay, removed, fileIds, tokens: sessions.map((row) => row.token) };
  });

  await eraseFiles(outcome.fileIds, now);
  await Promise.all([invalidatePeople([outcome.person]), invalidateSessionTokens(outcome.tokens), invalidateLive(personId)]);
  return { lastDay: outcome.lastDay, removed: outcome.removed };
}
