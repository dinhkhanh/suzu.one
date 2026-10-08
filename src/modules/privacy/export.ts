// "Export my data" (NFR-PRV-03; Law 91/2025, the data subject's right of access): one JSON file of
// everything the app holds about the signed-in person — their own data only, and all of it,
// compensation included (their contracts' pay terms and their payslips), which is why the action
// asks for a fresh step-up exactly like the payslip pages.
//
// One query per kind of record, all at once; nothing is read row by row. The readers that decrypt
// (restricted fields, pay terms, payslips) are the owning modules' own, asked with the person's
// principal — the same tier checks that guard their screens decide here too. Files are listed, not
// enclosed: each one opens from the app with its own audit entry.
import "server-only";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { contractSalaryTermsOf, getSensitiveFields, listContracts, listDocuments, listEmergencyContacts } from "@/modules/core-hr/service";
import { listDocumentsAbout } from "@/modules/documents/service";
import { payslipResultsOf } from "@/modules/payroll/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { consentHistoryOf } from "./consents";

/** Names the shape of the file, so a reader years from now knows which fields to expect. */
export const EXPORT_FORMAT = "suzu-one/my-data@1";

export type MyDataExport = { fileName: string; json: string; /** Records per section, for the audit entry — never the values. */ counts: Record<string, number> };

export async function buildMyDataExport(viewer: { personId: string; principal: Principal }, now: Date = new Date()): Promise<MyDataExport> {
  const { personId, principal } = viewer;
  const manager = alias(schema.person, "manager");

  const [
    [person],
    [profile],
    sensitive,
    emergencyContacts,
    dependents,
    employments,
    assignments,
    lifecycleEvents,
    contracts,
    salaryTerms,
    vaultDocuments,
    issuedDocuments,
    leaveRequests,
    leaveLedger,
    punches,
    attendanceRequests,
    timesheetMonths,
    timesheetDays,
    requests,
    notifications,
    payslips,
    conversations,
    messages,
    consents,
    [face],
  ] = await Promise.all([
    db()
      .select({
        id: schema.person.id,
        fullName: schema.person.fullName,
        workEmail: schema.person.workEmail,
        workforceType: schema.person.workforceType,
        status: schema.person.status,
        entity: schema.entity.legalName,
        unit: schema.orgUnit.name,
        manager: manager.fullName,
        createdAt: schema.person.createdAt,
      })
      .from(schema.person)
      .leftJoin(schema.entity, eq(schema.entity.id, schema.person.primaryEntityId))
      .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.orgUnitId))
      .leftJoin(manager, eq(manager.id, schema.person.managerId))
      .where(eq(schema.person.id, personId))
      .limit(1),
    db().select().from(schema.personProfile).where(eq(schema.personProfile.personId, personId)).limit(1),
    getSensitiveFields(principal, personId),
    listEmergencyContacts(principal, personId),
    db()
      .select()
      .from(schema.dependent)
      .where(and(eq(schema.dependent.personId, personId), isNull(schema.dependent.deletedAt)))
      .orderBy(asc(schema.dependent.createdAt)),
    db()
      .select({ employment: schema.employment, entity: schema.entity.legalName })
      .from(schema.employment)
      .innerJoin(schema.entity, eq(schema.entity.id, schema.employment.entityId))
      .where(eq(schema.employment.personId, personId))
      .orderBy(asc(schema.employment.startDate)),
    db()
      .select({ assignment: schema.assignment, unit: schema.orgUnit.name, position: schema.position.name, manager: manager.fullName })
      .from(schema.assignment)
      .innerJoin(schema.employment, eq(schema.employment.id, schema.assignment.employmentId))
      .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.assignment.orgUnitId))
      .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
      .leftJoin(manager, eq(manager.id, schema.assignment.managerId))
      .where(eq(schema.employment.personId, personId))
      .orderBy(asc(schema.assignment.validFrom)),
    db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.personId, personId)).orderBy(asc(schema.lifecycleEvent.effectiveDate)),
    listContracts(principal, personId),
    contractSalaryTermsOf(principal, personId),
    listDocuments(principal, personId),
    listDocumentsAbout(personId, principal),
    db()
      .select({ request: schema.leaveRequest, leaveType: schema.leaveType.code })
      .from(schema.leaveRequest)
      .innerJoin(schema.leaveType, eq(schema.leaveType.id, schema.leaveRequest.leaveTypeId))
      .where(eq(schema.leaveRequest.personId, personId))
      .orderBy(asc(schema.leaveRequest.startDate)),
    db()
      .select({ entry: schema.leaveLedgerEntry, leaveType: schema.leaveType.code })
      .from(schema.leaveLedgerEntry)
      .innerJoin(schema.leaveType, eq(schema.leaveType.id, schema.leaveLedgerEntry.leaveTypeId))
      .where(eq(schema.leaveLedgerEntry.personId, personId))
      .orderBy(asc(schema.leaveLedgerEntry.effectiveDate)),
    db().select().from(schema.punch).where(eq(schema.punch.personId, personId)).orderBy(asc(schema.punch.at)),
    db().select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.personId, personId)).orderBy(asc(schema.attendanceRequest.startDate)),
    db().select().from(schema.timesheetMonth).where(eq(schema.timesheetMonth.personId, personId)).orderBy(asc(schema.timesheetMonth.month)),
    db().select().from(schema.timesheetDay).where(eq(schema.timesheetDay.personId, personId)).orderBy(asc(schema.timesheetDay.date)),
    db()
      .select({
        id: schema.approvalRequest.id,
        type: schema.approvalRequest.type,
        typeName: schema.approvalRequest.typeName,
        summary: schema.approvalRequest.summary,
        payload: schema.approvalRequest.payload,
        status: schema.approvalRequest.status,
        createdAt: schema.approvalRequest.createdAt,
        decidedAt: schema.approvalRequest.decidedAt,
        askedByMe: sql<boolean>`${schema.approvalRequest.requesterPersonId} = ${personId}`,
      })
      .from(schema.approvalRequest)
      .where(or(eq(schema.approvalRequest.requesterPersonId, personId), eq(schema.approvalRequest.subjectPersonId, personId)))
      .orderBy(asc(schema.approvalRequest.createdAt)),
    db()
      .select({ kind: schema.notification.kind, params: schema.notification.params, link: schema.notification.link, createdAt: schema.notification.createdAt, readAt: schema.notification.readAt })
      .from(schema.notification)
      .where(eq(schema.notification.recipientPersonId, personId))
      .orderBy(desc(schema.notification.createdAt)),
    payslipResultsOf(personId),
    db().select().from(schema.aiConversation).where(eq(schema.aiConversation.personId, personId)).orderBy(asc(schema.aiConversation.createdAt)),
    db()
      // With the feedback they gave on an answer (FR-AGT-51): theirs too.
      .select({
        conversationId: schema.aiMessage.conversationId,
        role: schema.aiMessage.role,
        body: schema.aiMessage.body,
        toolResult: schema.aiMessage.toolResult,
        createdAt: schema.aiMessage.createdAt,
        feedback: { verdict: schema.aiFeedback.verdict, note: schema.aiFeedback.note, shared: schema.aiFeedback.shared },
      })
      .from(schema.aiMessage)
      .leftJoin(schema.aiFeedback, eq(schema.aiFeedback.messageId, schema.aiMessage.id))
      .where(eq(schema.aiMessage.personId, personId))
      .orderBy(asc(schema.aiMessage.createdAt)),
    consentHistoryOf(personId),
    // Whether the kiosk knows their face, and since when — never the templates themselves.
    db()
      .select({ consentAt: schema.faceEnrolment.consentAt, templates: sql<number>`(select count(*)::int from ${schema.faceTemplate} where ${schema.faceTemplate.personId} = ${personId})` })
      .from(schema.faceEnrolment)
      .where(eq(schema.faceEnrolment.personId, personId)),
  ]);

  // The dependants' ID and tax numbers come decrypted beside the restricted fields.
  const dependentNumbers = new Map((sensitive?.dependents ?? []).map((row) => [row.id, row]));
  const messagesOf = Map.groupBy(messages, (message) => message.conversationId);

  const data = {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    person: person ?? null,
    profile: profile ?? null,
    identityAndBank: sensitive ? { ...sensitive, dependents: undefined } : null,
    emergencyContacts: emergencyContacts ?? [],
    dependents: dependents.map((row) => ({
      fullName: row.fullName,
      relationship: row.relationship,
      dateOfBirth: row.dateOfBirth,
      idNumber: dependentNumbers.get(row.id)?.idNumber ?? null,
      taxCode: dependentNumbers.get(row.id)?.taxCode ?? null,
      deductionFrom: row.deductionFrom,
      deductionTo: row.deductionTo,
      note: row.note,
    })),
    employments: employments.map(({ employment, entity }) => ({ entity, employeeCode: employment.employeeCode, startDate: employment.startDate, seniorityDate: employment.seniorityDate, endDate: employment.endDate })),
    assignments: assignments.map(({ assignment, unit, position, manager: managerName }) => ({
      validFrom: assignment.validFrom,
      validTo: assignment.validTo,
      kind: assignment.kind,
      workforceType: assignment.workforceType,
      unit,
      position,
      seniorityLevel: assignment.seniorityLevel,
      positionLevel: assignment.positionLevel,
      manager: managerName,
      workLocation: assignment.workLocation,
      changeReason: assignment.changeReason,
    })),
    lifecycleEvents: lifecycleEvents.map((row) => ({ type: row.type, effectiveDate: row.effectiveDate, status: row.status, reason: row.reason, note: row.note, details: row.details })),
    contracts: (contracts ?? []).map((row) => ({
      number: row.number,
      type: row.type,
      jobCategory: row.jobCategory,
      signDate: row.signDate,
      startDate: row.startDate,
      endDate: row.endDate,
      terminatedOn: row.terminatedOn,
      note: row.note,
      salaryTerms: salaryTerms.get(row.id) ?? null,
      files: row.files?.map((file) => file.fileName) ?? [],
    })),
    documentsOnFile: vaultDocuments.map((row) => ({ category: row.category, title: row.title, fileName: row.fileName, expiresOn: row.expiresOn, uploadedAt: row.createdAt })),
    documentsIssued: issuedDocuments,
    leave: {
      requests: leaveRequests.map(({ request, leaveType }) => ({ ...request, leaveType })),
      ledger: leaveLedger.map(({ entry, leaveType }) => ({ ...entry, leaveType })),
    },
    attendance: { punches, requests: attendanceRequests, months: timesheetMonths, days: timesheetDays },
    requests,
    notifications,
    payslips,
    assistant: conversations.map((conversation) => ({
      title: conversation.title,
      createdAt: conversation.createdAt,
      messages: (messagesOf.get(conversation.id) ?? []).map(({ role, body, toolResult, createdAt, feedback }) => ({ role, body, toolResult, createdAt, ...(feedback?.verdict ? { feedback } : {}) })),
    })),
    privacy: {
      consents: consents.map((row) => ({ purpose: row.purpose, decision: row.decision, at: row.at, noticeVersion: row.noticeVersion, noticeLocale: row.noticeLocale, noticeText: row.noticeText })),
      faceEnrolment: face ? { templates: face.templates, consentAt: face.consentAt } : null,
    },
  };

  const counts = {
    emergencyContacts: data.emergencyContacts.length,
    dependents: data.dependents.length,
    employments: data.employments.length,
    contracts: data.contracts.length,
    documentsOnFile: data.documentsOnFile.length,
    documentsIssued: data.documentsIssued.length,
    leaveRequests: leaveRequests.length,
    punches: punches.length,
    attendanceRequests: attendanceRequests.length,
    timesheetDays: timesheetDays.length,
    requests: requests.length,
    notifications: notifications.length,
    payslips: payslips.length,
    conversations: conversations.length,
    consents: consents.length,
  };
  return { fileName: `suzu-one-my-data-${now.toISOString().slice(0, 10)}.json`, json: JSON.stringify(data, null, 2), counts };
}
