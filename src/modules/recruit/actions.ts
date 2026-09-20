"use server";
// Recruitment's mutations, each through the one pipeline (parse → authenticate → authorize → run
// → audit). Two things recur and are worth stating once:
//
//   · **Money is dropped before it reaches the service.** Every action that accepts a budget, a
//     salary band or a salary expectation checks `canSetRecruitMoney` and passes `null` when the
//     caller may not read it — so a recruiter posting the edit form by hand cannot set a band, and
//     an existing band is left exactly as it was rather than being wiped by a form that never
//     showed it.
//   · **Audit entries name the opening and the candidate, never a figure.** The audit log is read
//     far more widely than a salary band.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { STAGE_CATEGORIES } from "./enums";
import { CANDIDATE_SOURCES, EMPLOYMENT_TYPES, OPENING_MEMBER_ROLES, OPENING_STATUSES, RECRUIT_EMAIL_KINDS, REJECTION_REASONS, WORK_MODES } from "./enums";
import { saveEmailTemplate, sendCandidateEmail } from "./emails";
import { decideHiringRequest, submitHiringRequest } from "./hiring";
import {
  canActOnApplication,
  canEditOpening,
  canFileHiringRequest,
  canManageCandidates,
  canManagePipelines,
  canOpenFromHiringRequest,
  canRunRecruitment,
  canSetRecruitMoney,
} from "./policy";
import {
  createApplication,
  createCandidate,
  createOpening,
  findApplication,
  findHiringRequest,
  findOpening,
  isOpeningMember,
  moveApplicationStage,
  rejectApplication,
  savePipeline,
  setOpeningStatus,
  setOpeningTeam,
  updateCandidate,
  updateOpening,
  withdrawApplication,
} from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const integer = z.coerce.number().int();
/** Whole đồng, typed as Vietnam types it ("18.000.000") or as anywhere else does ("18,000,000"). */
const money = z.preprocess((value) => (typeof value === "string" ? value.replace(/[.,\s]/g, "") : value), z.coerce.number().int().min(0).max(10_000_000_000));
const lines = z.preprocess(
  (value) => (typeof value === "string" ? value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) : Array.isArray(value) ? value : []),
  z.array(z.string().max(500)).max(25),
);

const openingTargetOf = (row: { entityId: string; departmentId: string | null; teamId: string | null }) => ({ entityId: row.entityId, departmentId: row.departmentId, teamId: row.teamId });

// ── Hiring requests (FR-REC-01) ─────────────────────────────────────────────────────────────

const hiringRequestFields = {
  entityId: z.uuid(),
  departmentId: optional(z.uuid()),
  teamId: optional(z.uuid()),
  positionTitle: z.string().trim().min(2).max(200),
  jobLevel: optional(z.string().trim().max(80)),
  headcount: integer.min(1).max(100),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workLocation: optional(z.string().trim().max(200)),
  reason: z.string().trim().min(5).max(2000),
  targetStartDate: optional(z.iso.date()),
  hiringManagerPersonId: optional(z.uuid()),
  budgetMinVnd: optional(money),
  budgetMaxVnd: optional(money),
};

const submitHiringRequestPipeline = createAction({
  name: "recruit.hiring_request.submit",
  input: z.object(hiringRequestFields),
  authorize: (user) => canFileHiringRequest(user.principal),
  run: async ({ user, input }) => {
    const { budgetMinVnd, budgetMaxVnd, ...rest } = input;
    // A team lead asks for a head without naming a figure; only whoever may read bands sets one.
    const budget = canSetRecruitMoney(user.principal, { entityId: input.entityId, departmentId: input.departmentId, teamId: input.teamId }) ? { budgetMinVnd, budgetMaxVnd } : null;
    const { hiringRequest, requestId } = await submitHiringRequest(rest, budget, user.person.id);
    revalidatePath("/recruit/hiring");
    revalidatePath("/approvals");
    return {
      data: { id: hiringRequest.id, requestId },
      audit: {
        resource: { type: "hiring_request", id: hiringRequest.id, entityId: hiringRequest.entityId },
        summary: `${hiringRequest.positionTitle} × ${hiringRequest.headcount}`,
        after: { headcount: hiringRequest.headcount, employmentType: hiringRequest.employmentType, budgetSet: budget !== null && (budget.budgetMinVnd !== null || budget.budgetMaxVnd !== null) },
      },
    };
  },
});

const decideHiringRequestPipeline = createAction({
  name: "recruit.hiring_request.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: optional(z.string().trim().max(2000)) }),
  // The approval engine decides whether this person is the approver whose turn it is; it throws a
  // user-facing refusal when they are not, which is a different answer from "you may not be here".
  authorize: (user) => !!user.person.id,
  run: async ({ user, input }) => {
    const { request, outcome, hiringRequestId } = await decideHiringRequest(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    revalidatePath("/approvals");
    revalidatePath(`/recruit/hiring/${hiringRequestId}`);
    return {
      data: { outcome },
      audit: { resource: { type: "hiring_request", id: hiringRequestId, entityId: request.entityId }, summary: request.summary, after: { decision: input.decision, outcome } },
    };
  },
});

// ── Openings (FR-REC-02) ────────────────────────────────────────────────────────────────────

const openingFields = {
  title: z.string().trim().min(2).max(200),
  titleEn: optional(z.string().trim().max(200)),
  entityId: z.uuid(),
  departmentId: optional(z.uuid()),
  teamId: optional(z.uuid()),
  positionName: optional(z.string().trim().max(200)),
  jobLevel: optional(z.string().trim().max(80)),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workMode: z.enum(WORK_MODES),
  workLocation: optional(z.string().trim().max(200)),
  headcount: integer.min(1).max(100),
  description: z.string().trim().max(20_000).default(""),
  requirements: z.string().trim().max(20_000).default(""),
  benefits: z.string().trim().max(20_000).default(""),
  pipelineId: z.uuid(),
  targetStartDate: optional(z.iso.date()),
  salaryMinVnd: optional(money),
  salaryMaxVnd: optional(money),
  salaryPublic: checkbox,
};

const createOpeningPipeline = createAction({
  name: "recruit.opening.create",
  input: z.object({ ...openingFields, hiringRequestId: optional(z.uuid()) }),
  authorize: async (user, input) => {
    const target = { entityId: input.entityId, departmentId: input.departmentId, teamId: input.teamId };
    if (!canRunRecruitment(user.principal, target)) return false;
    if (!input.hiringRequestId) return true;
    // Opening *from* an approved ask: the ask must exist, be approved, and be one this person may act on.
    const request = await findHiringRequest(input.hiringRequestId);
    return !!request && request.status === "approved" && canOpenFromHiringRequest(user.principal, openingTargetOf(request));
  },
  run: async ({ user, input }) => {
    const { salaryMinVnd, salaryMaxVnd, salaryPublic, hiringRequestId, ...rest } = input;
    const target = { entityId: input.entityId, departmentId: input.departmentId, teamId: input.teamId };
    const money = canSetRecruitMoney(user.principal, target) ? { salaryMinVnd, salaryMaxVnd, salaryPublic } : null;
    const opening = await createOpening({ ...rest, questions: [] }, money, user.person.id, { hiringRequestId });
    revalidatePath("/recruit");
    return {
      data: { id: opening.id, code: opening.code },
      audit: { resource: { type: "job_opening", id: opening.id, entityId: opening.entityId }, summary: `${opening.code} ${opening.title}`, after: { status: opening.status, headcount: opening.headcount, fromHiringRequest: hiringRequestId } },
    };
  },
});

const updateOpeningPipeline = createAction({
  name: "recruit.opening.update",
  input: z.object({ openingId: z.uuid(), ...openingFields }),
  authorize: async (user, input) => {
    const before = await findOpening(input.openingId);
    // Both where it is and where it is being moved to: an opening cannot be walked into an entity
    // the editor does not run recruitment for.
    return !!before && canEditOpening(user.principal, openingTargetOf(before)) && canEditOpening(user.principal, { entityId: input.entityId, departmentId: input.departmentId, teamId: input.teamId });
  },
  run: async ({ user, input }) => {
    const { openingId, salaryMinVnd, salaryMaxVnd, salaryPublic, ...rest } = input;
    const money = canSetRecruitMoney(user.principal, { entityId: input.entityId, departmentId: input.departmentId, teamId: input.teamId }) ? { salaryMinVnd, salaryMaxVnd, salaryPublic } : null;
    const existing = await findOpening(openingId);
    const { before, after } = await updateOpening(openingId, { ...rest, questions: existing?.questions ?? [] }, money);
    revalidatePath(`/recruit/${openingId}`);
    revalidatePath("/recruit");
    return {
      data: { id: after.id },
      audit: { resource: { type: "job_opening", id: after.id, entityId: after.entityId }, summary: `${after.code} ${after.title}`, before: { title: before.title, headcount: before.headcount }, after: { title: after.title, headcount: after.headcount, bandChanged: money !== null } },
    };
  },
});

const setOpeningStatusPipeline = createAction({
  name: "recruit.opening.status",
  input: z.object({ openingId: z.uuid(), status: z.enum(OPENING_STATUSES), reason: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const opening = await findOpening(input.openingId);
    return !!opening && canEditOpening(user.principal, openingTargetOf(opening));
  },
  run: async ({ input }) => {
    const { before, after } = await setOpeningStatus(input.openingId, input.status, input.reason);
    revalidatePath(`/recruit/${input.openingId}`);
    revalidatePath("/recruit");
    return {
      data: { status: after.status },
      audit: { resource: { type: "job_opening", id: after.id, entityId: after.entityId }, summary: `${after.code} ${after.title}`, before: { status: before.status }, after: { status: after.status } },
    };
  },
});

const setOpeningTeamPipeline = createAction({
  name: "recruit.opening.team",
  input: z.object({
    openingId: z.uuid(),
    members: z.array(z.object({ personId: z.uuid(), role: z.enum(OPENING_MEMBER_ROLES) })).max(30).default([]),
  }),
  authorize: async (user, input) => {
    const opening = await findOpening(input.openingId);
    return !!opening && canEditOpening(user.principal, openingTargetOf(opening));
  },
  run: async ({ input }) => {
    const opening = await findOpening(input.openingId);
    const saved = await setOpeningTeam(input.openingId, input.members);
    revalidatePath(`/recruit/${input.openingId}`);
    return {
      data: { members: saved },
      audit: { resource: { type: "job_opening", id: input.openingId, entityId: opening?.entityId ?? null }, summary: `${opening?.code ?? ""} — hiring team`, after: { members: saved } },
    };
  },
});

// ── Pipelines ───────────────────────────────────────────────────────────────────────────────

const savePipelinePipeline = createAction({
  name: "recruit.pipeline.save",
  input: z.object({
    pipelineId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,23}$/),
    name: z.string().trim().min(2).max(120),
    nameEn: optional(z.string().trim().max(120)),
    description: optional(z.string().trim().max(500)),
    isDefault: checkbox,
    isActive: checkbox,
    stages: z
      .array(
        z.object({
          key: z.string().trim().regex(/^[a-z0-9][a-z0-9_]{1,31}$/),
          name: z.string().trim().min(1).max(80),
          nameEn: optional(z.string().trim().max(80)),
          category: z.enum(STAGE_CATEGORIES),
        }),
      )
      .min(1)
      .max(20),
  }),
  authorize: (user) => canManagePipelines(user.principal),
  run: async ({ input }) => {
    const { pipelineId, ...rest } = input;
    const { before, after } = await savePipeline(pipelineId, rest);
    revalidatePath("/recruit/pipelines");
    return {
      data: { id: after.id },
      audit: { resource: { type: "recruit_pipeline", id: after.id, entityId: null }, summary: `${after.code} ${after.name}`, before: before && { name: before.name }, after: { name: after.name, stages: input.stages.length } },
    };
  },
});

// ── Candidates (FR-REC-04) ──────────────────────────────────────────────────────────────────

const candidateFields = {
  fullName: z.string().trim().min(2).max(200),
  email: optional(z.email().max(200)),
  phone: optional(z.string().trim().max(40)),
  currentTitle: optional(z.string().trim().max(200)),
  currentEmployer: optional(z.string().trim().max(200)),
  location: optional(z.string().trim().max(200)),
  links: lines.default([]),
  source: z.enum(CANDIDATE_SOURCES),
  sourceDetail: optional(z.string().trim().max(200)),
  referredByPersonId: optional(z.uuid()),
  tags: lines.default([]),
  notes: optional(z.string().trim().max(5000)),
};

const createCandidatePipeline = createAction({
  name: "recruit.candidate.create",
  input: z.object({ ...candidateFields, confirmedNotDuplicate: checkbox.default(false) }),
  authorize: (user) => canManageCandidates(user.principal),
  run: async ({ user, input }) => {
    const { confirmedNotDuplicate, ...rest } = input;
    const candidate = await createCandidate(rest, user.person.id, { confirmedNotDuplicate });
    revalidatePath("/recruit/candidates");
    return {
      data: { id: candidate.id },
      audit: { resource: { type: "candidate", id: candidate.id, entityId: null }, summary: candidate.fullName, after: { source: candidate.source, confirmedNotDuplicate } },
    };
  },
});

const updateCandidatePipeline = createAction({
  name: "recruit.candidate.update",
  input: z.object({ candidateId: z.uuid(), ...candidateFields }),
  authorize: (user) => canManageCandidates(user.principal),
  run: async ({ input }) => {
    const { candidateId, ...rest } = input;
    const { before, after } = await updateCandidate(candidateId, rest);
    revalidatePath(`/recruit/candidates/${candidateId}`);
    return {
      data: { id: after.id },
      audit: { resource: { type: "candidate", id: after.id, entityId: null }, summary: after.fullName, before: { fullName: before.fullName }, after: { fullName: after.fullName } },
    };
  },
});

// ── Applications ────────────────────────────────────────────────────────────────────────────

const createApplicationPipeline = createAction({
  name: "recruit.application.create",
  input: z.object({
    candidateId: z.uuid(),
    openingId: z.uuid(),
    source: z.enum(CANDIDATE_SOURCES).default("direct"),
    sourceDetail: optional(z.string().trim().max(200)),
    coverLetter: optional(z.string().trim().max(10_000)),
    portfolioLinks: lines.default([]),
    salaryExpectationVnd: optional(money),
    salaryExpectationNote: optional(z.string().trim().max(500)),
  }),
  authorize: async (user, input) => {
    const opening = await findOpening(input.openingId);
    return !!opening && canRunRecruitment(user.principal, openingTargetOf(opening));
  },
  run: async ({ user, input }) => {
    const opening = await findOpening(input.openingId);
    const expectation = opening && canSetRecruitMoney(user.principal, openingTargetOf(opening)) ? input.salaryExpectationVnd : null;
    const application = await createApplication({ ...input, answers: {}, cvFileId: null, salaryExpectationVnd: expectation }, user.person.id);
    revalidatePath(`/recruit/${input.openingId}`);
    revalidatePath(`/recruit/candidates/${input.candidateId}`);
    return {
      data: { id: application.id },
      audit: { resource: { type: "job_application", id: application.id, entityId: opening?.entityId ?? null }, summary: `${opening?.code ?? ""} — application`, after: { candidateId: input.candidateId, source: application.source } },
    };
  },
});

const moveApplicationPipeline = createAction({
  name: "recruit.application.move",
  input: z.object({ applicationId: z.uuid(), stageId: z.uuid(), note: optional(z.string().trim().max(2000)) }),
  authorize: async (user, input) => {
    const application = await findApplication(input.applicationId);
    if (!application) return false;
    const opening = await findOpening(application.openingId);
    return !!opening && canActOnApplication(user.principal, openingTargetOf(opening), await isOpeningMember(opening.id, user.person.id));
  },
  run: async ({ user, input }) => {
    const { before, after, stage } = await moveApplicationStage(input.applicationId, input.stageId, user.person.id, input.note);
    revalidatePath(`/recruit/applications/${input.applicationId}`);
    revalidatePath(`/recruit/${after.openingId}`);
    return {
      data: { stageId: after.stageId, stageName: stage.name },
      audit: { resource: { type: "job_application", id: after.id, entityId: null }, summary: `→ ${stage.name}`, before: { stageId: before.stageId }, after: { stageId: after.stageId } },
    };
  },
});

const rejectApplicationPipeline = createAction({
  name: "recruit.application.reject",
  input: z.object({ applicationId: z.uuid(), reason: z.enum(REJECTION_REASONS), note: optional(z.string().trim().max(2000)) }),
  authorize: async (user, input) => {
    const application = await findApplication(input.applicationId);
    if (!application) return false;
    const opening = await findOpening(application.openingId);
    return !!opening && canActOnApplication(user.principal, openingTargetOf(opening), await isOpeningMember(opening.id, user.person.id));
  },
  run: async ({ user, input }) => {
    const { before, after } = await rejectApplication(input.applicationId, { reason: input.reason, note: input.note }, user.person.id);
    revalidatePath(`/recruit/applications/${input.applicationId}`);
    revalidatePath(`/recruit/${after.openingId}`);
    return {
      data: { status: after.status },
      audit: { resource: { type: "job_application", id: after.id, entityId: null }, summary: `rejected: ${input.reason}`, before: { status: before.status }, after: { status: after.status, reason: input.reason } },
    };
  },
});

const withdrawApplicationPipeline = createAction({
  name: "recruit.application.withdraw",
  input: z.object({ applicationId: z.uuid(), note: optional(z.string().trim().max(2000)) }),
  authorize: async (user, input) => {
    const application = await findApplication(input.applicationId);
    if (!application) return false;
    const opening = await findOpening(application.openingId);
    return !!opening && canActOnApplication(user.principal, openingTargetOf(opening), await isOpeningMember(opening.id, user.person.id));
  },
  run: async ({ user, input }) => {
    const { before, after } = await withdrawApplication(input.applicationId, user.person.id, input.note);
    revalidatePath(`/recruit/applications/${input.applicationId}`);
    revalidatePath(`/recruit/${after.openingId}`);
    return {
      data: { status: after.status },
      audit: { resource: { type: "job_application", id: after.id, entityId: null }, summary: "withdrawn", before: { status: before.status }, after: { status: after.status } },
    };
  },
});

// ── Candidate emails (FR-REC-05) ────────────────────────────────────────────────────────────

const sendCandidateEmailPipeline = createAction({
  name: "recruit.email.send",
  input: z.object({ applicationId: z.uuid(), templateId: z.uuid(), locale: z.enum(["vi", "en"]).default("vi") }),
  // The same authority that moves an application along writes to its candidate: the recruiter and
  // the opening's hiring team, and nobody else.
  authorize: async (user, input) => {
    const application = await findApplication(input.applicationId);
    if (!application) return false;
    const opening = await findOpening(application.openingId);
    return !!opening && canActOnApplication(user.principal, openingTargetOf(opening), await isOpeningMember(opening.id, user.person.id));
  },
  run: async ({ user, input }) => {
    const sent = await sendCandidateEmail(input.applicationId, input.templateId, { personId: user.person.id, fullName: user.person.fullName }, input.locale);
    revalidatePath(`/recruit/applications/${input.applicationId}`);
    return {
      data: { to: sent.to },
      // The subject, not the letter, and never the address: the audit log is read across the company.
      audit: { resource: { type: "job_application", id: input.applicationId, entityId: sent.entityId }, summary: sent.templateCode, after: { subject: sent.subject } },
    };
  },
});

const saveEmailTemplatePipeline = createAction({
  name: "recruit.email_template.save",
  input: z.object({
    templateId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/),
    name: z.string().trim().min(2).max(120),
    kind: z.enum(RECRUIT_EMAIL_KINDS),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10_000),
    subjectEn: optional(z.string().trim().max(200)),
    bodyEn: optional(z.string().trim().max(10_000)),
    isActive: checkbox,
  }),
  // The wordings are the group's, like the pipeline library.
  authorize: (user) => canManagePipelines(user.principal),
  run: async ({ user, input }) => {
    const { templateId, ...rest } = input;
    const { before, after } = await saveEmailTemplate(templateId, rest, user.person.id);
    revalidatePath("/recruit/emails");
    return {
      data: { id: after.id },
      audit: { resource: { type: "recruit_email_template", id: after.id, entityId: null }, summary: `${after.code} ${after.name}`, before: before && { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive } },
    };
  },
});

// A `"use server"` file may export nothing but async functions — exporting a pipeline as a const
// makes the bundler drop every export of the module (tests/server-actions.test.ts).

export async function submitHiringRequestAction(input: unknown) {
  return submitHiringRequestPipeline(input);
}

export async function decideHiringRequestAction(input: unknown) {
  return decideHiringRequestPipeline(input);
}

export async function createOpeningAction(input: unknown) {
  return createOpeningPipeline(input);
}

export async function updateOpeningAction(input: unknown) {
  return updateOpeningPipeline(input);
}

export async function setOpeningStatusAction(input: unknown) {
  return setOpeningStatusPipeline(input);
}

export async function setOpeningTeamAction(input: unknown) {
  return setOpeningTeamPipeline(input);
}

export async function saveRecruitPipelineAction(input: unknown) {
  return savePipelinePipeline(input);
}

export async function createCandidateAction(input: unknown) {
  return createCandidatePipeline(input);
}

export async function updateCandidateAction(input: unknown) {
  return updateCandidatePipeline(input);
}

export async function createApplicationAction(input: unknown) {
  return createApplicationPipeline(input);
}

export async function moveApplicationAction(input: unknown) {
  return moveApplicationPipeline(input);
}

export async function rejectApplicationAction(input: unknown) {
  return rejectApplicationPipeline(input);
}

export async function withdrawApplicationAction(input: unknown) {
  return withdrawApplicationPipeline(input);
}

export async function sendCandidateEmailAction(input: unknown) {
  return sendCandidateEmailPipeline(input);
}

export async function saveRecruitEmailTemplateAction(input: unknown) {
  return saveEmailTemplatePipeline(input);
}
