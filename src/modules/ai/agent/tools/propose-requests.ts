// Proposals of the asker's own requests (Phase 13 R4, FR-AGT-21): leave, an attendance request, a
// request of a type the administrator designed, and — for whoever leads work — a project's status
// update. Every one is the asker's own (no `personId` of anybody else is ever filled in), ends in
// `propose()` — a card, nothing filed — and is checked first the way its module will check it:
// leave is costed by `previewLeave`, the screen's own preview, and a card is only made when it
// finds no problem; a request's answers go through the form's own `validateSubmission`; a status
// update needs `canPostStatus` as `openProject` reads it. A name becomes an id only among what the
// module itself lists for the field: the leave types of the asker's entity, the request types the
// asker may file on /requests/new, the projects they may open.
import "server-only";
import { z } from "zod";
import { recordHref } from "@/lib/record-routes";
import { overtimeWarningsFor, submitAttendanceRequestInput, whoApprovesAttendance, windowOf } from "@/modules/attendance/service";
import { getPersonTarget } from "@/modules/core-hr/service";
import { type LeavePreview, leaveTypesFor, previewLeave, submitLeaveInput, whoApprovesLeave } from "@/modules/leave/service";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { HEALTHS, loadStatusFacts, openProject, postStatusUpdateInput, projectFollowers, type ProjectReader } from "@/modules/projects/service";
import { canFileRequests, EXPENSE_CLAIM_CODE, fileRequestInput, type FormField, type FormValues, listAvailableTypes, type RequestTypeRow, validateSubmission, visibleFields, whoApprovesRequest } from "@/modules/requests/service";
import { draftStatusSummary } from "../../drafts";
import { suggestedHealth } from "../../engine/drafts";
import { namedRows, pickNamedRow } from "../../engine/name-match";
import type { ProposalField } from "../../enums";
import { isUuid, notifyNames, notProposed, pickPerson, propose } from "../propose";
import { type AnyAgentTool, defineTool, type ToolResult } from "../registry";
import { projectLine, projectsMatching, visiblePortfolio } from "./lookup";

const everyone = () => true;
const DATE = z.iso.date();
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
/** "2026-10-26" → "26/10", for lists of days inside one field. */
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
/** "2026-10-26" → "26/10/2026", inside a field's text (the card formats a field that is only a date). */
const fullDate = (date: string) => `${dayMonth(date)}/${date.slice(0, 4)}`;
const hours = (minutes: number) => Math.round(minutes / 6) / 10;
/** The first step's approvers: the people the request reaches when it is filed. */
const firstApprovers = (steps: readonly { names: string[] }[]) => notifyNames(steps[0]?.names ?? []);

/**
 * One row of a small list the asker named: its code, its whole name, the words asked for — or, when
 * nothing holds them, the closest name (a typo, a shortened word, initials). Pure.
 */
export function pickNamed<Row>(rows: readonly Row[], query: string, words: (row: Row) => readonly (string | null | undefined)[]): { one: Row } | { many: Row[] } | { none: true } {
  const picked = pickNamedRow(rows, query, words);
  return "one" in picked ? { one: picked.one } : "many" in picked ? { many: picked.many } : picked;
}

// ── Leave ───────────────────────────────────────────────────────────────────────────────────

const proposeLeave = defineTool({
  name: "propose_leave",
  module: "leave",
  description:
    "Proposes a leave request of the asker's own for them to confirm (nothing is filed until they do). Give the leave type as the asker said it (its name or code, e.g. \"phép năm\", \"không lương\"), the first day and the last day (YYYY-MM-DD; one day: leave endDate out), and half days: startPortion am/pm for the first day, endPortion am for the last. The card shows the working days it counts, the balance and who on the asker's team is away then. If the type is unclear the result lists the types to ask about; if the request breaks a rule (notice, balance, eligibility) the result names the problems — explain them, nothing is proposed.",
  input: z.strictObject({
    leaveType: z.string().min(2).max(80).optional().describe("The leave type's name or code, as the asker said it."),
    startDate: DATE.describe("YYYY-MM-DD"),
    endDate: DATE.optional().describe("YYYY-MM-DD; default the start date."),
    startPortion: z.enum(["full", "am", "pm"]).optional().describe("The first day: full (default), am or pm only."),
    endPortion: z.enum(["full", "am"]).optional().describe("The last day: full (default) or am only."),
    reason: z.string().max(1000).optional(),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 12,
  tags: [],
  run: async (context, input) => {
    const { user, locale } = context;
    const personId = user.person.id;
    const target = await getPersonTarget(personId);
    if (!target) return notProposed("not_permitted", { note: "The asker has no employment record to take leave from." });
    const types = await leaveTypesFor(target.entityId ?? null);
    const nameOf = (type: { name: string; nameEn: string | null }) => (locale === "en" && type.nameEn ? type.nameEn : type.name);
    const choices = () => types.map((type) => ({ code: type.code, name: nameOf(type) }));
    if (!input.leaveType) return notProposed("which_leave_type", { types: choices(), next: "Ask the asker which kind of leave." });
    const picked = pickNamed(types, input.leaveType, (type) => [type.code, type.name, type.nameEn]);
    if ("none" in picked) return notProposed("leave_type_not_found", { types: choices() });
    if ("many" in picked) return notProposed("several_leave_types", { types: picked.many.map((type) => ({ code: type.code, name: nameOf(type) })), next: "Ask the asker which one." });
    const type = picked.one;

    const endDate = input.endDate ?? input.startDate;
    const startPortion = input.startPortion ?? "full";
    const endPortion = endDate === input.startDate ? startPortion : (input.endPortion ?? "full");
    const reason = input.reason?.trim() || null;
    const leave = { leaveTypeId: type.id, startDate: input.startDate, endDate, startPortion, endPortion, minutes: null, reason, attachmentFileId: null };
    const editHref = `/leave/new?${new URLSearchParams({ type: type.id, from: input.startDate, to: endDate, startPortion, endPortion }).toString()}&proposal={id}`;

    let preview: LeavePreview;
    try {
      preview = await previewLeave(personId, leave);
    } catch (error) {
      return notProposed(error instanceof Error ? error.message : "leave_invalid");
    }
    // The action refuses a request with any problem (an attachment included, which only the form can add).
    if (preview.problems.length > 0) return notProposed("leave_problems", { problems: preview.problems, link: editHref.replace("&proposal={id}", ""), next: "Explain the problems to the asker; nothing was proposed." });

    const days = preview.counted.totalCenti / 100;
    const { colleaguesAway, shortfalls } = preview.conflicts;
    const fields: ProposalField[] = [
      { key: "leaveType", text: nameOf(type) },
      { key: "startDate", text: input.startDate },
      ...(endDate !== input.startDate ? [{ key: "endDate", text: endDate }] : []),
      ...(startPortion !== "full" ? [{ key: "startPortion", valueKey: `portion_${startPortion}` }] : []),
      ...(endDate !== input.startDate && endPortion !== "full" ? [{ key: "endPortion", valueKey: `portion_${endPortion}` }] : []),
      { key: "days", valueKey: "days", params: { days } },
    ];
    if (type.tracksBalance) {
      const available = preview.availableByYear[Number(input.startDate.slice(0, 4))];
      if (available !== undefined) fields.push({ key: "available", valueKey: "days", params: { days: available / 100 } });
    }
    if (colleaguesAway.length > 0) fields.push({ key: "colleaguesAway", text: colleaguesAway.map((row) => `${row.name}: ${row.dates.map(dayMonth).join(", ")}`).join("\n") });
    if (shortfalls.length > 0) fields.push({ key: "shortfall", valueKey: "shortfall", params: { dates: shortfalls.map((row) => dayMonth(row.date)).join(", "), min: shortfalls[0].minPresent } });
    if (reason) fields.push({ key: "reason", text: reason });

    return propose(context, "propose_leave", {
      action: "leave.request.submit",
      schema: submitLeaveInput,
      input: { personId: null, ...leave },
      fields,
      notify: firstApprovers(await whoApprovesLeave(personId, days)),
      editHref,
      subject: { type: "person", id: personId },
      summary: { leaveType: nameOf(type), startDate: input.startDate, endDate, days, colleaguesAway: colleaguesAway.map((row) => row.name).join(", ") || null, shortfallDays: shortfalls.length || null, reason },
    });
  },
});

// ── Attendance requests ─────────────────────────────────────────────────────────────────────

const ATTENDANCE_TYPES = ["attendance_correction", "remote_work", "overtime", "holiday_work"] as const;

const proposeAttendanceRequest = defineTool({
  name: "propose_attendance_request",
  module: "attendance",
  description:
    "Proposes an attendance request of the asker's own for them to confirm (nothing is filed until they do). type attendance_correction: a missed or wrong punch on a past day — date, inTime and/or outTime (HH:MM), cause forgot / device_error / other. type remote_work: work from home, off site or a business trip — date (and endDate for several days), kind wfh / off_site / business_trip, portion full / am / pm, locationName for off_site and business_trip. type overtime (a working day) or holiday_work (a rest day or holiday): date, from and to (HH:MM), compensation pay or time_off. A reason is always needed: ask the asker for it rather than inventing one.",
  input: z.strictObject({
    type: z.enum(ATTENDANCE_TYPES),
    date: DATE.describe("YYYY-MM-DD; for remote_work the first day."),
    endDate: DATE.optional().describe("remote_work only: the last day."),
    reason: z.string().max(1000).optional().describe("In the asker's words, 3 characters at least."),
    inTime: TIME.optional(),
    outTime: TIME.optional(),
    outNextDay: z.boolean().optional().describe("attendance_correction: the out punch was after midnight."),
    cause: z.enum(["forgot", "device_error", "other"]).optional(),
    kind: z.enum(["wfh", "off_site", "business_trip"]).optional(),
    portion: z.enum(["full", "am", "pm"]).optional(),
    locationName: z.string().max(200).optional(),
    from: TIME.optional(),
    to: TIME.optional(),
    compensation: z.enum(["pay", "time_off"]).optional(),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user, today } = context;
    const personId = user.person.id;
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) return notProposed("reason_required", { next: "Ask the asker why." });
    const { type, date } = input;
    const fields: ProposalField[] = [{ key: "attendanceType", valueKey: `attendance_${type}` }, { key: "date", text: date }];
    const action: Record<string, unknown> = { personId: null, type, startDate: date, endDate: null, reason, evidenceFileId: null };
    const summary: Record<string, string | number | boolean | null> = { type, date, reason };
    const editParams = new URLSearchParams({ type, date });

    // What the service refuses without reading anything, refused here so no card is made for it;
    // the rest (a locked month, a second request that day, the kind of day) is the action's to say.
    if (type === "attendance_correction") {
      if (date > today) return notProposed("correction_future");
      if (!input.inTime && !input.outTime) return notProposed("correction_needs_time", { next: "Ask the asker the time they came in and/or left." });
      const outNextDay = !!input.outNextDay && !!input.outTime;
      if (input.inTime && input.outTime && !outNextDay && input.outTime <= input.inTime) return notProposed("correction_out_before_in");
      const cause = input.cause ?? "forgot";
      Object.assign(action, { cause, inTime: input.inTime ?? null, outTime: input.outTime ?? null, outNextDay });
      if (input.inTime) fields.push({ key: "inTime", text: input.inTime });
      if (input.outTime) fields.push({ key: "outTime", text: outNextDay ? `${input.outTime} (+1)` : input.outTime });
      fields.push({ key: "cause", valueKey: `cause_${cause}` });
      Object.assign(summary, { inTime: input.inTime ?? null, outTime: input.outTime ?? null, cause });
    } else if (type === "remote_work") {
      const endDate = input.endDate ?? date;
      if (endDate < date) return notProposed("attendance_request_dates");
      const kind = input.kind ?? "wfh";
      const portion = input.portion ?? "full";
      const locationName = input.locationName?.trim() || null;
      if (kind !== "wfh" && !locationName) return notProposed("remote_needs_location", { next: "Ask the asker where they will work." });
      if (portion !== "full" && endDate !== date) return notProposed("remote_half_day_one_day");
      Object.assign(action, { endDate, kind, portion, locationName });
      if (endDate !== date) fields.push({ key: "endDate", text: endDate });
      fields.push({ key: "remoteKind", valueKey: `remote_${kind}` }, { key: "portion", valueKey: `portion_${portion}` });
      if (locationName) fields.push({ key: "location", text: locationName });
      Object.assign(summary, { endDate, kind, portion, location: locationName });
    } else {
      const window = input.from && input.to ? windowOf(input.from, input.to) : null;
      if (type === "overtime" && !window) return notProposed("overtime_window_invalid", { next: "Ask the asker from what time to what time." });
      if (type === "holiday_work" && (input.from || input.to) && !window) return notProposed("overtime_window_invalid");
      if (window && window.minutes > 16 * 60) return notProposed("overtime_window_invalid");
      if (!input.compensation) return notProposed("overtime_compensation_required", { choices: ["pay", "time_off"], next: "Ask the asker whether it is paid or taken back as time off." });
      Object.assign(action, { from: input.from ?? null, to: input.to ?? null, compensation: input.compensation });
      if (window) fields.push({ key: "window", text: `${input.from}–${input.to}` }, { key: "overtimeHours", valueKey: "hours", params: { hours: hours(window.minutes) } });
      fields.push({ key: "compensation", valueKey: `compensation_${input.compensation}` });
      // Warnings, never refusals: the caps bind the employer, and the approver decides with them.
      for (const warning of await overtimeWarningsFor(personId, date, window?.minutes ?? 0)) fields.push({ key: "overtimeWarning", valueKey: warning.code, params: { total: hours(warning.totalMinutes), limit: warning.limitMinutes / 60 } });
      Object.assign(summary, { from: input.from ?? null, to: input.to ?? null, compensation: input.compensation });
    }
    fields.push({ key: "reason", text: reason });

    return propose(context, "propose_attendance_request", {
      action: "attendance.request.submit",
      schema: submitAttendanceRequestInput,
      input: action,
      fields,
      notify: firstApprovers(await whoApprovesAttendance(type, personId)),
      editHref: `/attendance/requests/new?${editParams.toString()}&proposal={id}`,
      subject: { type: "person", id: personId },
      summary,
    });
  },
});

// ── Requests the administrator designed ─────────────────────────────────────────────────────

type Answer = string | number | boolean | string[] | null;

/** A form's fields as the model may ask about them: labels in the asker's language, options as values and labels. */
const formFieldsFor = (fields: readonly FormField[], locale: "vi" | "en") =>
  fields.map((field) => ({
    key: field.key,
    label: locale === "en" ? field.labelEn : field.labelVi,
    type: field.type,
    required: !!field.required,
    ...(field.options?.length ? { options: field.options.map((option) => ({ value: option.value, label: locale === "en" ? option.labelEn : option.labelVi })) } : {}),
    ...(field.multiple ? { multiple: true } : {}),
    ...(field.min != null ? { min: field.min } : {}),
    ...(field.max != null ? { max: field.max } : {}),
    ...(field.minLength != null ? { minLength: field.minLength } : {}),
    ...(field.visibleWhen ? { onlyWhen: field.visibleWhen } : {}),
    ...(field.type === "file" ? { note: "An attachment: only the form can add it." } : {}),
  }));

/**
 * The asker's answers in the shape the form stores: a choice by its value or its label, a person by
 * name among the people the form offers, an entity by code or name. What cannot be read is left as
 * given, for `validateSubmission` to name. Attachments are never taken from a model.
 */
async function answersFor(fields: readonly FormField[], raw: Record<string, Answer>, askerId: string): Promise<{ values: FormValues } | ToolResult> {
  const values: FormValues = {};
  const [people, entities] = await Promise.all([fields.some((field) => field.type === "person") ? listPersonNames() : [], fields.some((field) => field.type === "entity") ? listEntities() : []]);
  for (const field of fields) {
    const given = raw[field.key];
    if (given === undefined || given === null || field.type === "file") continue;
    const list = Array.isArray(given) ? given : [given];
    if (field.type === "select" || field.type === "multi_select") {
      const options = field.options ?? [];
      const mapped = list.map((entry) => {
        const hit = pickNamed(options, String(entry), (option) => [option.value, option.labelVi, option.labelEn]);
        return "one" in hit ? hit.one.value : String(entry);
      });
      values[field.key] = field.type === "select" ? mapped[0] : mapped;
    } else if (field.type === "person") {
      const ids: string[] = [];
      for (const entry of list) {
        const hit = pickPerson(people, String(entry), askerId);
        if ("many" in hit) return notProposed("several_people", { field: field.key, people: hit.many.map((person) => ({ personId: person.id, name: person.fullName })), next: "Ask the asker which one." });
        if ("none" in hit) return notProposed("person_not_found", { field: field.key });
        ids.push(hit.one.id);
      }
      values[field.key] = field.multiple ? ids : (ids[0] ?? null);
    } else if (field.type === "entity") {
      const ids: string[] = [];
      for (const entry of list) {
        const hit = isUuid(String(entry)) ? entities.filter((entity) => entity.id === String(entry).trim()) : namedRows(entities, String(entry), (entity) => [entity.code, entity.shortName, entity.legalName]).rows;
        if (hit.length !== 1) return notProposed("entity_not_found", { field: field.key, entities: entities.map((entity) => ({ code: entity.code, name: entity.shortName })) });
        ids.push(hit[0].id);
      }
      values[field.key] = field.multiple ? ids : (ids[0] ?? null);
    } else {
      values[field.key] = given;
    }
  }
  return { values };
}

/** One answer as the card shows it, in the asker's language. */
function shownAnswer(field: FormField, value: Answer, names: Map<string, string>, locale: "vi" | "en"): string {
  const list = Array.isArray(value) ? value : [value];
  const one = (entry: string | number | boolean | null): string => {
    if (entry === null) return "";
    if (field.type === "checkbox") return entry ? "✓" : "—";
    if (field.type === "money" && typeof entry === "number") return `${new Intl.NumberFormat("vi-VN").format(entry)} ₫`;
    if (field.type === "number" && typeof entry === "number") return new Intl.NumberFormat(locale === "en" ? "en-US" : "vi-VN").format(entry);
    if (field.type === "date" && typeof entry === "string") return fullDate(entry);
    if (field.type === "select" || field.type === "multi_select") {
      const option = field.options?.find((candidate) => candidate.value === entry);
      return option ? (locale === "en" ? option.labelEn : option.labelVi) : String(entry);
    }
    if (field.type === "person" || field.type === "entity") return names.get(String(entry)) ?? String(entry);
    return String(entry);
  };
  return list.map(one).filter(Boolean).join(", ");
}

const proposeRequest = defineTool({
  name: "propose_request",
  module: "requests",
  description:
    "Proposes one of the company's requests (purchase, payment, advance, business trip, IT support, a confirmation letter… as the company designed them) of the asker's own, for them to confirm (nothing is filed until they do). Give the request type by name or code as the asker said it. The first call without values returns the form's fields (key, label, type, required, options): ask the asker for what is required, then call again with values keyed by field key — a choice by its value or label, a person by name, a date as YYYY-MM-DD, money as whole đồng. Attachments cannot be added here: when the form needs one, give the asker the link instead.",
  input: z.strictObject({
    type: z.string().min(2).max(80).describe("The request type's name or code, as the asker said it."),
    values: z.record(z.string().max(40), z.union([z.string().max(4000), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()])).optional().describe("Answers keyed by the form's field keys."),
  }),
  offeredTo: (principal) => canFileRequests(principal),
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 30,
  tags: [],
  run: async (context, input) => {
    const { user, locale } = context;
    const personId = user.person.id;
    if (!canFileRequests(user.principal)) return notProposed("not_permitted");
    const target = await getPersonTarget(personId);
    // The types the asker may file on /requests/new; the expense claim has its own form and action.
    const types = (await listAvailableTypes(target?.entityId ?? null)).filter((row) => row.code !== EXPENSE_CLAIM_CODE);
    const nameOf = (row: RequestTypeRow) => (locale === "en" ? row.nameEn : row.nameVi);
    const list = (rows: readonly RequestTypeRow[]) => rows.map((row) => ({ code: row.code, name: nameOf(row) }));
    const picked = pickNamed(types, input.type, (row) => [row.code, row.nameVi, row.nameEn]);
    if ("none" in picked) return notProposed("request_type_not_found", { types: list(types) });
    if ("many" in picked) return notProposed("several_request_types", { types: list(picked.many), next: "Ask the asker which one." });
    const type = picked.one;
    const link = `/requests/new/${type.code}`;
    const formFields = formFieldsFor(type.form.fields, locale);
    if (!input.values || Object.keys(input.values).length === 0) {
      return notProposed("fields_needed", { type: { code: type.code, name: nameOf(type) }, fields: formFields, link, next: "Ask the asker for the required fields, then call again with values keyed by field key." });
    }

    const read = await answersFor(type.form.fields, input.values, personId);
    if ("outcome" in read) return read;
    // The form's own rules, as filing will apply them.
    const { values, problems } = validateSubmission(type.form, read.values);
    const shown = visibleFields(type.form, values);
    const attachment = problems.find((problem) => shown.find((field) => field.key === problem.field)?.type === "file");
    if (attachment) return notProposed("needs_attachment", { field: attachment.field, link, next: "The form needs an attachment: give the asker the link to file it there." });
    if (problems.length > 0) return notProposed("invalid_values", { problems, fields: formFields, next: "Ask the asker for what is missing or wrong, then call again." });

    const names = new Map<string, string>();
    if (shown.some((field) => field.type === "person")) for (const person of await listPersonNames()) names.set(person.id, person.fullName);
    if (shown.some((field) => field.type === "entity")) for (const entity of await listEntities()) names.set(entity.id, entity.shortName);
    const fields: ProposalField[] = [{ key: "requestType", text: nameOf(type) }];
    const summary: Record<string, string | number | boolean | null> = { type: nameOf(type) };
    for (const field of shown) {
      const value = values[field.key];
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0) || field.type === "file") continue;
      const label = locale === "en" ? field.labelEn : field.labelVi;
      const text = shownAnswer(field, value, names, locale);
      fields.push({ key: "formField", label, text, href: field.type === "person" && typeof value === "string" ? recordHref("person", value) : null });
      summary[field.key] = text;
    }

    return propose(context, "propose_request", {
      action: "request.file",
      schema: fileRequestInput,
      input: { code: type.code, values, parentRequestId: null },
      fields,
      notify: firstApprovers(await whoApprovesRequest(type, personId, values)),
      editHref: `${link}?proposal={id}`,
      subject: { type: "request_type", id: type.id },
      summary,
    });
  },
});

// ── A project's status update ───────────────────────────────────────────────────────────────

const TEXT = z.string().max(4000);

const proposeStatusUpdate = defineTool({
  name: "propose_status_update",
  module: "projects",
  description:
    "Proposes a status update of a project the asker leads (as its lead, account manager, or lead of its team), for them to confirm (nothing is posted until they do). Name the project by name, job number or projectId. Give health on_track / at_risk / off_track and the summary in the asker's words when they gave them; without a summary one is drafted from the project's facts (and a health suggested), which the asker reads on the card. Highlights and next steps are optional.",
  input: z.strictObject({
    project: z.string().min(2).max(120).describe("Project name, job number, or a projectId a tool gave you."),
    health: z.enum(HEALTHS).optional(),
    summary: TEXT.optional(),
    highlights: TEXT.optional(),
    nextSteps: TEXT.optional(),
  }),
  offeredTo: (_principal, facts) => facts.leadsWork,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user, today, locale } = context;
    const rows = await visiblePortfolio(user, today);
    const matching = isUuid(input.project) ? rows.filter((row) => row.id === input.project.trim()) : projectsMatching(rows, input.project).rows;
    if (matching.length === 0) return notProposed("project_not_found");
    if (matching.length > 1) return notProposed("several_projects", { projects: matching.slice(0, 8).map(projectLine), next: "Ask the asker which project." });
    const row = matching[0];
    const opened = await openProject(user as unknown as ProjectReader, row.id);
    if (!opened || !opened.can.postStatus) return notProposed("not_permitted", { note: "Only the project's lead, its account manager or the lead of its team may post its status, and not once it is closed." });
    const projectId = opened.project.id;

    let summary = input.summary?.trim() || null;
    let health = input.health ?? null;
    let drafted = false;
    if (!summary) {
      const draft = await draftStatusSummary(user, projectId, locale, today);
      if (!draft?.draft.summary.trim()) return notProposed("summary_needed", { next: "Ask the asker how the project is going." });
      summary = draft.draft.summary.trim();
      health ??= draft.draft.health;
      drafted = true;
    }
    // Health from the same facts a draft would weigh, when the asker gave words but no health.
    health ??= suggestedHealth(await loadStatusFacts(projectId, { budgetMinutes: opened.plan.budgetMinutes, baseline: opened.plan.baseline }, today));
    const highlights = input.highlights?.trim() || null;
    const nextSteps = input.nextSteps?.trim() || null;

    // The members, roles and team leads hear of it (status-updates.ts).
    const followers = await projectFollowers(projectId, user.person.id);
    const names = new Map((await listPersonNames()).map((person) => [person.id, person.fullName]));
    const label = [row.jobNumber, row.name].filter(Boolean).join(" · ");
    const fields: ProposalField[] = [
      { key: "project", text: label, href: recordHref("project", projectId) },
      { key: "health", valueKey: `health_${health}` },
      { key: "summary", text: summary },
      ...(highlights ? [{ key: "highlights", text: highlights }] : []),
      ...(nextSteps ? [{ key: "nextSteps", text: nextSteps }] : []),
    ];
    return propose(context, "propose_status_update", {
      action: "projects.status.post",
      schema: postStatusUpdateInput,
      input: { projectId, health, summary, highlights, nextSteps },
      fields,
      notify: notifyNames(followers.map((id) => names.get(id) ?? "")),
      editHref: `/projects/${projectId}/updates?proposal={id}`,
      subject: { type: "project", id: projectId },
      summary: { project: label, health, summary, drafted, highlights, nextSteps },
    });
  },
});

export const PROPOSE_REQUEST_TOOLS: readonly AnyAgentTool[] = [proposeLeave, proposeAttendanceRequest, proposeRequest, proposeStatusUpdate];
