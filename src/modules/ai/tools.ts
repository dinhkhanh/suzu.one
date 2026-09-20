// The personal tools (FR-AI-02, 06): leave balance, payslip explanation, approver lookup,
// attendance summary. This is the file that decides whether the assistant may answer with a
// person's own data, so its rules are stated plainly and there are only four of them.
//
//  1. **THE SUBJECT IS ALWAYS THE ASKER.** `runTool` never takes a person id from a question, a
//     model, or a retrieved page. It takes `user.person.id`. A question that names somebody else
//     is refused with `other_person` — it is not quietly answered about the asker, and no name is
//     ever resolved to a person, so there is no directory lookup to abuse.
//  2. **THE OWNING MODULE DECIDES.** Every figure is read through that module's own `service.ts`,
//     through a function that takes the asker's `principal` and answers null when it says no —
//     `getLeaveBalanceFor`, `getMonthSummaryFor`, `getPayslipView`. The same rule as the screen:
//     a line manager is refused a payslip here because `canViewCompensationOf` refuses them one
//     on /payslips. Nothing in this module reads another module's tables.
//  3. **COMPENSATION KEEPS ITS SECOND LOCK.** The payslip page asks for a recent
//     re-authentication (FR-PLT-06); so does the payslip tool. A stale session gets `step_up`
//     and a link, not a figure.
//  4. **THE ANSWER IS DATA, NOT PROSE.** A tool returns message keys and numbers (`ToolOutcome`),
//     which the chat renders in the reader's language. Nothing here writes a sentence, so
//     "did a figure about somebody else get out?" is a question about a small JSON object.
//
// The same executor runs whatever driver is configured: the routing that reaches it is pure and
// runs before retrieval, so there is no key, model or page that opens a second road to a tool.
import "server-only";
import { todayInVietnam } from "@/lib/dates";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import type { Principal } from "@/modules/platform/rbac/policy";
import { getMonthSummaryFor, whoApprovesAttendance } from "@/modules/attendance/service";
import { getLeaveBalanceFor, whoApprovesLeave } from "@/modules/leave/service";
import { getPayslipView, listMyPayslips } from "@/modules/payroll/service";
import type { ToolOutcome } from "./enums";
import type { ApproverKind, ToolName, ToolRoute } from "./engine/routing";

/** What a tool call records in the audit log. Never a figure — the outcome and the subject only. */
export type ToolAudit = { tool: ToolName; subjectPersonId: string; outcome: ToolOutcome["status"]; reason: string | null };

export type ToolRun = { outcome: ToolOutcome; audit: ToolAudit };

/**
 * Everything a tool needs of the asker, and deliberately no more: who they are, what they may do,
 * and how recently they proved it. `CurrentUser` satisfies it. There is no field for "the person
 * this is about" — that is the point (rule 1).
 */
export type ToolUser = { person: { id: string }; principal: Principal; reauthAt?: Date | null };

const refuse = (tool: ToolName, reason: Exclude<ToolOutcome, { status: "answered" }>["reason"], link: string | null = null, params: Record<string, string | number> = {}): ToolOutcome => ({ status: "refused", tool, reason, params, link });

const DAYS = (centi: number) => Math.round(centi) / 100;
const HOURS = (minutes: number) => Math.round(minutes / 6) / 10;

// ── The four tools ──────────────────────────────────────────────────────────────────────────

async function leaveBalance(user: ToolUser, route: ToolRoute): Promise<ToolOutcome> {
  const year = Number((route.month ?? todayInVietnam()).slice(0, 4));
  // The owning module's door, with the asker's own principal. Null = "not for you".
  const balances = await getLeaveBalanceFor(user.principal, user.person.id, year);
  if (!balances) return refuse("leave_balance", "not_permitted", "/leave");
  const tracked = balances.filter((row) => row.balanceCenti !== 0 || row.usedCenti !== 0 || row.availableCenti !== 0);
  if (tracked.length === 0) return refuse("leave_balance", "nothing_yet", "/leave", { year });
  const annual = tracked.find((row) => row.code === "ANNUAL") ?? tracked[0];
  return {
    status: "answered",
    tool: "leave_balance",
    key: "summary",
    params: { year, code: annual.code, available: DAYS(annual.availableCenti), used: DAYS(annual.usedCenti), pending: DAYS(annual.pendingCenti) },
    lines: tracked.map((row) => ({ key: "type", params: { name: row.name, nameEn: row.nameEn ?? row.name, available: DAYS(row.availableCenti), used: DAYS(row.usedCenti), pending: DAYS(row.pendingCenti) } })),
    link: "/leave",
  };
}

async function attendanceSummary(user: ToolUser, route: ToolRoute): Promise<ToolOutcome> {
  const month = route.month ?? todayInVietnam().slice(0, 7);
  const summary = await getMonthSummaryFor(user.principal, user.person.id, month);
  if (!summary) return refuse("attendance_summary", "not_permitted", "/attendance");
  if (summary.days === 0) return refuse("attendance_summary", "nothing_yet", "/attendance", { month });
  return {
    status: "answered",
    tool: "attendance_summary",
    key: "summary",
    params: {
      month,
      days: summary.days,
      lateCount: summary.lateCount,
      lateMinutes: summary.lateMinutes,
      earlyCount: summary.earlyCount,
      absentDays: summary.absentDays,
      missingPunchDays: summary.missingPunchDays,
      workedHours: HOURS(summary.workedMinutes),
      overtimeHours: HOURS(summary.otTotalMinutes),
      paidDays: DAYS(summary.paidDaysCenti),
    },
    lines: [],
    link: "/attendance",
  };
}

const APPROVER_LOOKUP: Record<ApproverKind, (personId: string) => Promise<{ key: string; names: string[] }[]>> = {
  leave: (personId) => whoApprovesLeave(personId),
  overtime: (personId) => whoApprovesAttendance("overtime", personId),
  remote_work: (personId) => whoApprovesAttendance("remote_work", personId),
  attendance_correction: (personId) => whoApprovesAttendance("attendance_correction", personId),
  holiday_work: (personId) => whoApprovesAttendance("holiday_work", personId),
};

async function approverLookup(user: ToolUser, route: ToolRoute): Promise<ToolOutcome> {
  const kind = route.requestKind ?? "leave";
  // An approver's name is directory-tier and the flow is about the asker's own request, so there
  // is no figure and no tier question here — but the subject is still clamped to the asker, so a
  // question about a colleague's approvers is refused above, before this runs.
  const steps = await APPROVER_LOOKUP[kind](user.person.id);
  if (steps.length === 0) return refuse("approver_lookup", "nothing_yet", "/approvals", { kind });
  return {
    status: "answered",
    tool: "approver_lookup",
    key: "summary",
    params: { kind, first: steps[0].names.join(", ") },
    lines: steps.map((step) => ({ key: "step", params: { step: step.key, names: step.names.join(", ") } })),
    link: kind === "leave" ? "/leave/new" : "/attendance",
  };
}

async function payslipExplain(user: ToolUser, route: ToolRoute): Promise<ToolOutcome> {
  // Compensation, so the same second lock as the payslip page (FR-PLT-06). Checked before
  // anything is read, so a stale session learns nothing — not even whether a payslip exists.
  if (!isStepUpFresh(user.reauthAt ?? null)) return refuse("payslip_explain", "step_up", "/step-up?next=%2Fassistant");
  // Own payslips only: there is no call in payroll that lists somebody else's.
  const mine = await listMyPayslips(user.person.id);
  const wanted = route.month ? mine.find((row) => row.month === route.month) : mine[0];
  if (!wanted) return refuse("payslip_explain", "nothing_yet", "/payslips", route.month ? { month: route.month } : {});
  // And the read itself is authorized again inside payroll: self, C&B over the entity, or the
  // owner. A manager who somehow held an id would get null here.
  const view = await getPayslipView(user.principal, wanted.id);
  if (!view || view.person.id !== user.person.id) return refuse("payslip_explain", "not_permitted", "/payslips");

  const { totals } = view.result;
  const name = (code: string) => view.componentNames.get(code) ?? code;
  // The biggest earnings and deductions, largest first — what a person actually asks about.
  const top = (kind: "earning" | "deduction") =>
    view.result.lines
      .filter((line) => line.kind === kind && line.amount !== 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6)
      .map((line) => ({ key: kind, params: { code: line.code, name: name(line.code), amount: line.amount, rule: line.rule } }));

  return {
    status: "answered",
    tool: "payslip_explain",
    key: "summary",
    params: {
      month: view.run.month,
      entity: view.entity.shortName,
      gross: totals.grossEarnings,
      insurance: totals.employeeInsurance,
      union: totals.unionDues,
      pit: totals.pit,
      otherDeductions: totals.otherDeductions,
      deductions: totals.totalDeductions,
      net: totals.net,
      paidDays: DAYS(view.result.proration.paidDaysCenti),
      standardDays: view.result.proration.standardDays,
    },
    lines: [...top("earning"), ...top("deduction")],
    link: `/payslips/${wanted.id}`,
  };
}

const TOOLS: Record<ToolName, (user: ToolUser, route: ToolRoute) => Promise<ToolOutcome>> = {
  leave_balance: leaveBalance,
  payslip_explain: payslipExplain,
  approver_lookup: approverLookup,
  attendance_summary: attendanceSummary,
};

/**
 * Runs the tool the question asked for, as the person who asked. The only entry point; `ask`
 * audits whatever comes back.
 */
export async function runTool(user: ToolUser, route: ToolRoute): Promise<ToolRun> {
  const audit = (outcome: ToolOutcome): ToolRun => ({ outcome, audit: { tool: route.tool, subjectPersonId: user.person.id, outcome: outcome.status, reason: outcome.status === "refused" ? outcome.reason : null } });
  // Rule 1, and it is the first line for a reason: nothing below ever sees the name.
  if (route.subject === "other") return audit(refuse(route.tool, "other_person"));
  return audit(await TOOLS[route.tool](user, route));
}
