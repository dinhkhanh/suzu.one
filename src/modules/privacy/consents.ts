// Recorded notices and the answers to them (NFR-PRV-01): GPS at check-in, answered in the app and
// withdrawn there too, and the face kiosk's withdrawals. Consent is personal data about a choice
// the person can change at any moment, so nothing here is cached: the check-in reads it fresh.
import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { db, schema, type Tx } from "@/lib/db";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type ConsentState, GPS_NOTICE_VERSION, gpsConsentState, PUNCH_POSITION_RETENTION_DAYS } from "./engine/retention";

type Executor = Tx | ReturnType<typeof db>;
export type ConsentEventRow = typeof schema.privacyConsentEvent.$inferSelect;

/** The person's latest answer to the GPS notice, and when they gave it. */
export async function gpsConsentOf(personId: string, executor: Executor = db()): Promise<{ state: ConsentState; at: Date | null; version: string | null }> {
  const [latest] = await executor
    .select({ decision: schema.privacyConsentEvent.decision, noticeVersion: schema.privacyConsentEvent.noticeVersion, at: schema.privacyConsentEvent.at })
    .from(schema.privacyConsentEvent)
    .where(and(eq(schema.privacyConsentEvent.personId, personId), eq(schema.privacyConsentEvent.purpose, "gps_check_in")))
    .orderBy(desc(schema.privacyConsentEvent.at), desc(schema.privacyConsentEvent.id))
    .limit(1);
  const state = gpsConsentState(latest ?? null);
  return { state, at: state === "unanswered" ? null : (latest?.at ?? null), version: latest?.noticeVersion ?? null };
}

/** Whether the check-in may keep the position the phone sent: only with the current notice agreed to. */
export async function mayRecordPosition(personId: string, executor: Executor = db()): Promise<boolean> {
  return (await gpsConsentOf(personId, executor)).state === "given";
}

/**
 * The GPS notice in words, as the check-in key shows it — the text kept on the answer. Built from
 * the same messages the dialog renders, in the language it was shown in.
 */
export function gpsNoticeText(locale: string): string {
  const t = createTranslator({ locale: locale === "en" ? "en" : "vi", messages: locale === "en" ? en : vi, namespace: "privacy.gpsNotice" });
  const days = PUNCH_POSITION_RETENTION_DAYS;
  return [t("title"), t("what"), t("why"), t("who"), t("howLong", { days }), t("choice")].join("\n");
}

/** Writes one answer. "given" and "declined" carry the notice as shown; a withdrawal carries none. */
export async function recordConsentEvent(
  input: { personId: string; purpose: ConsentEventRow["purpose"]; decision: ConsentEventRow["decision"]; notice?: { version: string; locale: string; text: string } | null },
  executor: Executor = db(),
): Promise<ConsentEventRow> {
  const [row] = await executor
    .insert(schema.privacyConsentEvent)
    .values({ personId: input.personId, purpose: input.purpose, decision: input.decision, noticeVersion: input.notice?.version ?? null, noticeLocale: input.notice?.locale ?? null, noticeText: input.notice?.text ?? null })
    .returning();
  return row;
}

/** A GPS answer with the current notice in the reader's language. */
export function recordGpsAnswer(personId: string, decision: "given" | "declined", locale: string, executor: Executor = db()): Promise<ConsentEventRow> {
  return recordConsentEvent({ personId, purpose: "gps_check_in", decision, notice: { version: GPS_NOTICE_VERSION, locale: locale === "en" ? "en" : "vi", text: gpsNoticeText(locale) } }, executor);
}

/**
 * Which of these people withdrew their consent to face check-in and have not been enrolled again
 * since (a new enrolment needs a newly signed form, which moves `face_enrolment.consent_at` past the
 * withdrawal). The NAS kiosk's roster leaves them out, so the NAS stops recognising them at its next
 * sync and deletes their faces by its own purge (docs/privacy). One query for the whole roster.
 */
export async function faceWithdrawnAmong(personIds: readonly string[], executor: Executor = db()): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const latest = executor
    .selectDistinctOn([schema.privacyConsentEvent.personId], { personId: schema.privacyConsentEvent.personId, decision: schema.privacyConsentEvent.decision, at: schema.privacyConsentEvent.at })
    .from(schema.privacyConsentEvent)
    .where(and(eq(schema.privacyConsentEvent.purpose, "face_check_in"), inArray(schema.privacyConsentEvent.personId, [...personIds])))
    .orderBy(schema.privacyConsentEvent.personId, desc(schema.privacyConsentEvent.at), desc(schema.privacyConsentEvent.id))
    .as("latest");
  const rows = await executor
    .select({ personId: latest.personId })
    .from(latest)
    .leftJoin(schema.faceEnrolment, eq(schema.faceEnrolment.personId, latest.personId))
    .where(and(eq(latest.decision, "withdrawn"), sql`(${schema.faceEnrolment.consentAt} is null or ${schema.faceEnrolment.consentAt} <= ${latest.at})`));
  return new Set(rows.map((row) => row.personId));
}

/** Every answer the person ever gave, newest first — for their own export. */
export async function consentHistoryOf(personId: string): Promise<ConsentEventRow[]> {
  return db().select().from(schema.privacyConsentEvent).where(eq(schema.privacyConsentEvent.personId, personId)).orderBy(desc(schema.privacyConsentEvent.at));
}
