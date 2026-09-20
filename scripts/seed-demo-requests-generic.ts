// Demo data for the request builder (FR-REQ-01, 02): real-looking requests at every stage a
// request can be in — waiting on the first approver (and waiting long enough that the SLA job has
// something to nudge about), waiting on the second because the first said yes, sent back for
// changes, approved end to end, and one refused with the reason on the record.
//
// The rows are written the way the approval engine writes them, as the other demo seeds do: a
// seed script cannot call the `server-only` use-cases, so the shape is mirrored here and the
// flows are read from the very `approval_flow` rows `pnpm db:seed` created.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { approvalAssignee, approvalEvent, approvalFlow, approvalRequest, approvalStep, expenseClaimLine, person, requestSubmission, requestType, roleAssignment } from "../src/lib/db/schema";
import type { ExpenseCategory } from "../src/modules/requests/engine/expense";

type Db = ReturnType<typeof drizzle>;
type PersonRow = typeof person.$inferSelect;
type TypeRow = typeof requestType.$inferSelect;
type Rule = { rule: string; permission?: string; role?: string; level?: number };
type Step = { key: string; mode: "any" | "all"; approvers: Rule[]; condition?: { field: string; op: string; value: unknown } };

const dong = (amount: number) => `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

type Demo = {
  code: string;
  requester: string;
  daysAgo: number;
  values: Record<string, unknown>;
  /** Who answers, in order, and what they say. An empty list leaves it waiting. */
  decisions: { by: string; action: "approve" | "reject" | "return" }[];
  /** An expense claim's lines (FR-REQ-03); its figure is their sum, never something typed. */
  lines?: { lineDate: string; category: ExpenseCategory; description: string; amount: number; projectTag?: string | null }[];
};

const DEMO: Demo[] = [
  {
    code: "purchase",
    requester: "huy.ho@suzu.group",
    daysAgo: 4,
    values: { item: "Ổ cứng SSD 2TB cho phòng dựng", quantity: 2, amount: 7_200_000, category: "it", supplier: "Phong Vũ", needed_by: day(10), reason: "Dự án cuối năm cần chỗ lưu footage 4K, ổ hiện tại đã đầy." },
    decisions: [],
  },
  {
    code: "purchase",
    requester: "tam.bui@suzu.group",
    daysAgo: 2,
    values: { item: "Bộ đèn LED Aputure 600D", quantity: 1, amount: 28_500_000, category: "equipment", supplier: "Bình Minh Digital", needed_by: day(21), reason: "Thay bộ đèn cũ đã hỏng chấn lưu; cần cho ba dự án quay trong quý." },
    decisions: [{ by: "long.dang@suzu.group", action: "approve" }],
  },
  {
    code: "payment",
    requester: "duc.phan@suzu.group",
    daysAgo: 3,
    values: { payee: "Công ty TNHH In ấn Tân Thành", amount: 4_150_000, method: "transfer", bank_account: "0123456789 — Vietcombank CN Tân Bình", due_date: day(7), purpose: "In standee và backdrop cho sự kiện ra mắt sản phẩm của khách hàng." },
    decisions: [{ by: "ha.nguyen@suzu.vn", action: "return" }],
  },
  {
    code: "advance",
    requester: "khoi.ly@suzu.group",
    daysAgo: 12,
    values: { amount: 3_000_000, purpose: "Tạm ứng mua đạo cụ cho buổi chụp sản phẩm ngày 25.", settle_by: day(9), method: "cash", agree: true },
    decisions: [
      { by: "chi.duong@suzu.group", action: "approve" },
      { by: "tuan.vo@suzu.group", action: "approve" },
    ],
  },
  {
    code: "confirmation_letter",
    requester: "linh.do@suzu.group",
    daysAgo: 1,
    values: { letter_kind: "employment", addressed_to: "Đại sứ quán Nhật Bản tại Hà Nội", language: "both", copies: 2, needed_by: day(14), purpose: "Xin visa du lịch." },
    decisions: [],
  },
  {
    code: "business_trip",
    requester: "huy.ho@suzu.group",
    daysAgo: 8,
    values: { destination: "Đà Nẵng", start_date: day(20), end_date: day(23), transport: ["plane"], amount: 9_800_000, needs_accommodation: true, accommodation_note: "Khách sạn gần khu vực quay, 3 đêm.", purpose: "Khảo sát địa điểm và gặp khách hàng cho dự án quý sau." },
    decisions: [{ by: "long.dang@suzu.group", action: "reject" }],
  },
  {
    // Approved end to end: the manager, then finance. Its figure waits for a payroll run, and the
    // September draft takes it as soon as `pnpm db:seed:demo:payroll` has made one.
    code: "expense_claim",
    requester: "tam.bui@suzu.group",
    daysAgo: 6,
    values: { title: "Khảo sát địa điểm quay tại Đà Lạt", project_tag: "Phim quảng cáo Trà Ô Long", note: "Chi hộ đoàn tiền xe và ăn trưa hai ngày khảo sát." },
    lines: [
      { lineDate: day(-9), category: "transport", description: "Vé xe khách Sài Gòn – Đà Lạt (2 người)", amount: 640_000, projectTag: "Trà Ô Long" },
      { lineDate: day(-9), category: "meals", description: "Ăn trưa đoàn khảo sát", amount: 385_000, projectTag: "Trà Ô Long" },
      { lineDate: day(-8), category: "transport", description: "Thuê xe máy đi các điểm quay", amount: 300_000, projectTag: "Trà Ô Long" },
      { lineDate: day(-8), category: "meals", description: "Ăn trưa ngày thứ hai", amount: 420_000, projectTag: "Trà Ô Long" },
    ],
    decisions: [
      { by: "long.dang@suzu.group", action: "approve" },
      { by: "tuan.vo@suzu.group", action: "approve" },
    ],
  },
  {
    // Still on the first approver's desk.
    code: "expense_claim",
    requester: "khoi.ly@suzu.group",
    daysAgo: 2,
    values: { title: "Vật tư in thử bộ nhận diện", project_tag: "Rebrand Minh An", note: null },
    lines: [
      { lineDate: day(-3), category: "supplies", description: "Giấy mỹ thuật và mẫu in thử", amount: 275_000, projectTag: "Minh An" },
      { lineDate: day(-2), category: "transport", description: "Grab đi lấy bản in tại xưởng", amount: 96_000, projectTag: "Minh An" },
    ],
    decisions: [],
  },
];

export async function seedGenericRequests(db: Db): Promise<number> {
  const types = new Map((await db.select().from(requestType)).map((row) => [row.code, row]));
  if (DEMO.some((demo) => !types.has(demo.code))) {
    console.log("Skipped demo requests: run `pnpm db:seed` first so the request types exist.");
    return 0;
  }
  // Idempotent: whatever is already there stays as it is.
  const [existing] = await db.select({ id: requestSubmission.id }).from(requestSubmission).limit(1);
  if (existing) return 0;

  const emails = [...new Set(DEMO.flatMap((demo) => [demo.requester, ...demo.decisions.map((decision) => decision.by)]))];
  const people = new Map((await db.select().from(person).where(inArray(person.workEmail, emails))).map((row) => [row.workEmail!, row]));
  const everyone = await db.select().from(person).where(eq(person.status, "active"));
  const grants = await db.select().from(roleAssignment);
  const flows = new Map((await db.select().from(approvalFlow)).map((row) => [row.requestType, row]));

  let made = 0;
  for (const demo of DEMO) {
    const requester = people.get(demo.requester);
    const type = types.get(demo.code)!;
    if (!requester) continue;

    const definition = (flows.get(`request:${type.code}`)?.definition ?? { steps: [] }) as { steps: Step[] };
    const steps: { key: string; mode: "any" | "all"; applies: boolean; approverIds: string[] }[] = [];
    for (const step of definition.steps) {
      const applies = holds(step.condition, demo.values);
      const approverIds = applies ? peopleFor(step.approvers, requester, everyone, grants).filter((id) => id !== requester.id) : [];
      // The engine's rule: the line manager who is also the department head is asked once — a step
      // whose only approver already stands alone on an earlier step would be them saying yes twice.
      const duplicate = approverIds.length === 1 && steps.some((earlier) => earlier.applies && earlier.approverIds.length === 1 && earlier.approverIds[0] === approverIds[0]);
      steps.push({ key: step.key, mode: step.mode, applies: applies && !duplicate, approverIds: duplicate ? [] : approverIds });
    }
    // A step nobody can answer would be approved by the owners in the real engine; here it is
    // simply left out of the demo rather than faking a fallback.
    if (steps.some((step) => step.applies && step.approverIds.length === 0)) continue;

    const id = randomUUID();
    const filedAt = at(demo.daysAgo);
    await db.insert(approvalRequest).values({
      id,
      type: `request:${type.code}`,
      typeName: type.nameVi,
      entityId: requester.primaryEntityId,
      requesterPersonId: requester.id,
      subjectPersonId: requester.id,
      subjectType: "request_type",
      subjectId: type.id,
      summary: summarize(type, demo.values, demo.lines?.reduce((total, line) => total + line.amount, 0)),
      payload: { ...conditionData(type, demo.values), ...(demo.lines ? { amount: demo.lines.reduce((total, line) => total + line.amount, 0), lines: demo.lines.length } : {}) },
      flowSnapshot: { definition, source: "group", resolved: steps.map(({ key, mode, applies, approverIds }) => ({ key, mode, applies, approverIds })) },
      link: `/approvals/request/${id}`,
      createdAt: filedAt,
      updatedAt: filedAt,
    });

    const stepRows: { id: string; index: number; approverIds: string[] }[] = [];
    for (const [index, step] of steps.entries()) {
      const [row] = await db
        .insert(approvalStep)
        .values({ requestId: id, stepIndex: index, key: step.key, mode: step.mode, status: !step.applies ? "skipped" : firstApplying(steps) === index ? "pending" : "waiting" })
        .returning({ id: approvalStep.id });
      if (step.approverIds.length) await db.insert(approvalAssignee).values(step.approverIds.map((approverPersonId) => ({ stepId: row.id, requestId: id, approverPersonId })));
      stepRows.push({ id: row.id, index, approverIds: step.approverIds });
    }
    await db.insert(approvalEvent).values({ requestId: id, type: "submitted", actorPersonId: requester.id, stepIndex: firstApplying(steps), at: filedAt });

    const amountField = type.form.fields.find((field) => field.type === "money")?.key;
    const [submission] = await db
      .insert(requestSubmission)
      .values({
        approvalRequestId: id,
        requestTypeId: type.id,
        typeCode: type.code,
        values: demo.values,
        // An expense claim's figure is its lines added up; every other type's is its money field.
        amount: demo.lines ? demo.lines.reduce((total, line) => total + line.amount, 0) : amountField && typeof demo.values[amountField] === "number" ? (demo.values[amountField] as number) : null,
        createdAt: filedAt,
        updatedAt: filedAt,
      })
      .returning({ id: requestSubmission.id });
    if (demo.lines) {
      await db.insert(expenseClaimLine).values(demo.lines.map((line, index) => ({ submissionId: submission.id, lineDate: line.lineDate, category: line.category, description: line.description, amount: line.amount, projectTag: line.projectTag ?? null, sortOrder: index })));
    }

    // Walk the decisions the demo asked for, one open step at a time.
    let current = firstApplying(steps);
    for (const [order, decision] of demo.decisions.entries()) {
      const actor = people.get(decision.by);
      const step = stepRows.find((row) => row.index === current);
      if (!actor || !step || !step.approverIds.includes(actor.id)) break;
      const decidedAt = at(Math.max(0, demo.daysAgo - order - 1));

      await db
        .update(approvalAssignee)
        .set({ status: decision.action === "approve" ? "approved" : decision.action === "reject" ? "rejected" : "returned", comment: decision.action === "approve" ? null : reasonFor(decision.action), decidedAt })
        .where(eq(approvalAssignee.stepId, step.id));
      await db.insert(approvalEvent).values({
        requestId: id,
        type: decision.action === "approve" ? "approved" : decision.action === "reject" ? "rejected" : "returned",
        actorPersonId: actor.id,
        stepIndex: current,
        comment: decision.action === "approve" ? null : reasonFor(decision.action),
        at: decidedAt,
      });

      if (decision.action !== "approve") {
        await db.update(approvalStep).set({ status: decision.action === "reject" ? "rejected" : "waiting" }).where(eq(approvalStep.id, step.id));
        await db.update(approvalRequest).set({ status: decision.action === "reject" ? "rejected" : "returned", decidedAt: decision.action === "reject" ? decidedAt : null, updatedAt: decidedAt }).where(eq(approvalRequest.id, id));
        break;
      }

      await db.update(approvalStep).set({ status: "approved" }).where(eq(approvalStep.id, step.id));
      const next = nextApplying(steps, current);
      if (next === null) {
        await db.update(approvalRequest).set({ status: "approved", currentStep: current, decidedAt, updatedAt: decidedAt }).where(eq(approvalRequest.id, id));
        break;
      }
      const nextRow = stepRows.find((row) => row.index === next)!;
      await db.update(approvalStep).set({ status: "pending" }).where(eq(approvalStep.id, nextRow.id));
      await db.update(approvalRequest).set({ currentStep: next, updatedAt: decidedAt }).where(eq(approvalRequest.id, id));
      current = next;
    }
    made++;
  }
  return made;
}

const reasonFor = (action: "reject" | "return") =>
  action === "reject" ? "Chưa phải thời điểm: hoãn sang quý sau khi có ngân sách." : "Thiếu hóa đơn đỏ và mã số thuế của nhà cung cấp — bổ sung rồi gửi lại giúp mình.";

const firstApplying = (steps: { applies: boolean }[]) => Math.max(0, steps.findIndex((step) => step.applies));
const nextApplying = (steps: { applies: boolean }[], after: number) => {
  const index = steps.findIndex((step, position) => position > after && step.applies);
  return index < 0 ? null : index;
};

function holds(condition: { field: string; op: string; value: unknown } | undefined, values: Record<string, unknown>): boolean {
  if (!condition) return true;
  const actual = values[condition.field];
  if (condition.op === "eq") return actual === condition.value;
  if (condition.op === "ne") return actual !== condition.value;
  if (typeof actual !== "number" || typeof condition.value !== "number") return false;
  return condition.op === "gt" ? actual > condition.value : condition.op === "gte" ? actual >= condition.value : condition.op === "lt" ? actual < condition.value : actual <= condition.value;
}

/** The engine's approver rules, as far as the demo's flows use them. */
function peopleFor(rules: Rule[], requester: PersonRow, everyone: PersonRow[], grants: (typeof roleAssignment.$inferSelect)[]): string[] {
  const found = new Set<string>();
  const holdersOf = (roles: string[]) => {
    for (const grant of grants) {
      if (!roles.includes(grant.role)) continue;
      const covers = grant.scopeType === "group" || (grant.scopeType === "entity" && grant.scopeId === requester.primaryEntityId) || (grant.scopeType === "department" && grant.scopeId === requester.departmentId);
      if (covers && grant.personId) found.add(grant.personId);
    }
  };
  for (const rule of rules) {
    if (rule.rule === "line_manager" && requester.managerId) found.add(requester.managerId);
    else if (rule.rule === "department_head") holdersOf(["department_head"]);
    else if (rule.rule === "role" && rule.role) holdersOf([rule.role]);
    else if (rule.rule === "permission" && rule.permission === "payroll:pay") holdersOf(["finance", "payroll"]);
    else if (rule.rule === "permission" && rule.permission === "person:manage") holdersOf(["hr_admin", "hr_staff"]);
  }
  // Only people who are still here can answer.
  const active = new Set(everyone.map((row) => row.id));
  return [...found].filter((id) => active.has(id));
}

function summarize(type: TypeRow, values: Record<string, unknown>, override?: number): string {
  const amountField = type.form.fields.find((field) => field.type === "money")?.key;
  const amount = override ?? (amountField && typeof values[amountField] === "number" ? (values[amountField] as number) : null);
  const first = type.form.fields.find((field) => (field.type === "text" || field.type === "textarea") && typeof values[field.key] === "string" && (values[field.key] as string).length > 0);
  const words = first ? String(values[first.key]).replaceAll(/\s+/g, " ").slice(0, 120) : "";
  return [amount === null ? null : dong(amount), words || null].filter(Boolean).join(" · ") || type.nameVi;
}

/** What a flow's conditions are tested against: the single comparable answers, as the service stores them. */
function conditionData(type: TypeRow, values: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of type.form.fields) {
    if (!["money", "number", "select", "checkbox"].includes(field.type)) continue;
    const value = values[field.key];
    if (value !== undefined && value !== null && !Array.isArray(value)) data[field.key] = value;
  }
  return data;
}
