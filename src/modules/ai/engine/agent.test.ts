// The agent's pure parts (Phase 13 R1), golden: D38's tier rules and the per-turn ceilings, what of
// a conversation goes with a follow-up, what of a tool's rows a model may read, and who gets the
// agent while it is piloted.
import { describe, expect, it } from "vitest";
import { asksToAct } from "./routing";
import type { Principal } from "@/modules/platform/rbac/policy";
import { agentAudienceAdmits } from "../policy";
import { isClarifyingQuestion, isUngrounded, toolResultText } from "./agent-prompt";
import { historyFor } from "./history";
import { type CalledTool, FIRST_STEP, firstStep, nextStep, TURN_CEILINGS } from "./tiers";
import { modelRows, modelText } from "./views";

const leave: CalledTool = { name: "my_leave", module: "leave", tags: [] };
const leaveAgain: CalledTool = { name: "my_leave", module: "leave", tags: [] };
const tasks: CalledTool = { name: "my_tasks", module: "work", tags: [] };
const hr: CalledTool = { name: "hr_headcount", module: "core-hr", tags: ["complex"] };
const health: CalledTool = { name: "company_health", module: "reports", tags: ["analysis"] };

describe("which model takes the next call (D38)", () => {
  it("starts every turn on the simple tier, with tools", () => {
    expect(FIRST_STEP).toEqual({ kind: "call", tier: "simple", withTools: true });
  });

  it("stays on Haiku while the turn is one module's look-ups", () => {
    expect(nextStep({ tier: "simple", calls: 1, callsOnTier: 1, tools: [leave] })).toEqual({ kind: "call", tier: "simple", withTools: true });
    expect(nextStep({ tier: "simple", calls: 2, callsOnTier: 2, tools: [leave, leaveAgain] })).toEqual({ kind: "call", tier: "simple", withTools: true });
  });

  it("hands the turn to Sonnet when it spans modules, calls a complex tool, or Haiku has had its share", () => {
    expect(nextStep({ tier: "simple", calls: 1, callsOnTier: 1, tools: [leave, tasks] })).toMatchObject({ tier: "standard", withTools: true });
    expect(nextStep({ tier: "simple", calls: 1, callsOnTier: 1, tools: [hr] })).toMatchObject({ tier: "standard", withTools: true });
    expect(nextStep({ tier: "simple", calls: 3, callsOnTier: 3, tools: [leave, leave, leave] })).toMatchObject({ tier: "standard", withTools: true });
  });

  it("lets Opus write the answer, with no tools, after an analysis tool", () => {
    expect(nextStep({ tier: "simple", calls: 1, callsOnTier: 1, tools: [health] })).toEqual({ kind: "call", tier: "complex", withTools: false });
    expect(nextStep({ tier: "standard", calls: 2, callsOnTier: 1, tools: [leave, health] })).toEqual({ kind: "call", tier: "complex", withTools: false });
  });

  it("spends Sonnet's last call on Opus writing from what was read, never on another tool", () => {
    expect(nextStep({ tier: "standard", calls: 4, callsOnTier: 1, tools: [leave, tasks] })).toEqual({ kind: "call", tier: "standard", withTools: true });
    expect(nextStep({ tier: "standard", calls: 5, callsOnTier: 2, tools: [leave, tasks] })).toEqual({ kind: "call", tier: "complex", withTools: false });
  });

  it("stops at the ceiling, and after Opus", () => {
    expect(nextStep({ tier: "standard", calls: TURN_CEILINGS.modelCalls, callsOnTier: 3, tools: [leave] })).toEqual({ kind: "stop" });
    expect(nextStep({ tier: "complex", calls: 2, callsOnTier: 1, tools: [health] })).toEqual({ kind: "stop" });
  });

  it("keeps the ceilings of FR-AGT-42", () => {
    expect(TURN_CEILINGS).toMatchObject({ modelCalls: 6, outputTokens: 2000, wallClockMs: 40_000, rowsPerTool: 30 });
  });
});

describe("what goes with a follow-up (FR-AGT-04)", () => {
  it("keeps the last six turns as text, oldest first, ending with an answer", () => {
    const past = Array.from({ length: 10 }, (_, turn) => [
      { role: "user" as const, body: `q${turn}` },
      { role: "assistant" as const, body: `a${turn}` },
    ]).flat();
    const history = historyFor(past);
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ role: "user", content: "q4" });
    expect(history.at(-1)).toEqual({ role: "assistant", content: "a9" });
  });

  it("leaves out answers that were not kept, and never starts or ends on the wrong side", () => {
    expect(
      historyFor([
        { role: "assistant", body: "stray" },
        { role: "user", body: "lương tháng 8 của tôi?" },
        // D36: an answer that held pay is stored empty.
        { role: "assistant", body: "" },
        { role: "user", body: "còn phép không?" },
        { role: "assistant", body: "Còn 9 ngày." },
        { role: "user", body: "unanswered question" },
      ]),
    ).toEqual([
      { role: "user", content: "lương tháng 8 của tôi?\n\ncòn phép không?" },
      { role: "assistant", content: "Còn 9 ngày." },
    ]);
  });

  it("is empty for a new conversation", () => {
    expect(historyFor([])).toEqual([]);
  });
});

describe("what of a tool's rows a model reads (FR-AGT-30)", () => {
  const rows = [
    { key: "VID-1", title: "Gọi khách 0912 345 678 về banner", secretNote: "do not send", due: "2026-10-08" },
    { key: "VID-2", title: "Gửi file cho lan@client.vn", secretNote: "do not send", due: null },
    { key: "VID-3", title: "Dựng video", secretNote: "do not send", due: "2026-10-09" },
  ];

  it("sends the allowed fields only — a field the spec does not name is not there", () => {
    const view = modelRows(rows, { key: "value", title: "text", due: "value" }, 30);
    expect(view.rows.every((row) => !("secretNote" in row))).toBe(true);
    expect(JSON.stringify(view)).not.toContain("do not send");
  });

  it("takes contact details out of typed text", () => {
    const text = JSON.stringify(modelRows(rows, { title: "text" }, 30));
    expect(text).not.toContain("0912");
    expect(text).not.toContain("lan@client.vn");
    expect(text).toContain("Dựng video");
  });

  it("caps the rows and counts the rest", () => {
    expect(modelRows(rows, { key: "value" }, 2)).toEqual({ rows: [{ key: "VID-1" }, { key: "VID-2" }], total: 3, more: 1 });
  });

  it("cuts long text and drops empty text", () => {
    expect(modelText("x".repeat(400))?.length).toBe(301);
    expect(modelText("   ")).toBeNull();
    expect(modelText(null)).toBeNull();
  });

  it("frames a result as one object with the tool and its outcome first", () => {
    expect(JSON.parse(toolResultText("my_leave", "answered", { year: 2026 }))).toEqual({ tool: "my_leave", outcome: "answered", year: 2026 });
  });
});

describe("who gets the agent while it is piloted (R1)", () => {
  const person = (grants: Principal["grants"]): Principal => ({ personId: "p", workforceType: "employee", grants });
  const pilot = { audience: "pilot" as const, pilotEmails: "huy.ho@suzu.group, Lan.Tran@suzu.group" };

  it("admits the owners and the listed emails, whatever their case", () => {
    expect(agentAudienceAdmits(person([{ role: "owner", scope: { type: "group" } }]), "owner@suzu.vn", pilot)).toBe(true);
    expect(agentAudienceAdmits(person([]), "lan.tran@suzu.group", pilot)).toBe(true);
    expect(agentAudienceAdmits(person([]), "HUY.HO@suzu.group", pilot)).toBe(true);
  });

  it("leaves everybody else on Phase 9's assistant until the audience is everyone", () => {
    expect(agentAudienceAdmits(person([{ role: "hr_admin", scope: { type: "group" } }]), "hr@suzu.group", pilot)).toBe(false);
    expect(agentAudienceAdmits(person([]), null, pilot)).toBe(false);
    expect(agentAudienceAdmits(person([]), "", { audience: "pilot", pilotEmails: "" })).toBe(false);
    expect(agentAudienceAdmits(person([]), "anyone@suzu.group", { audience: "everyone", pilotEmails: "" })).toBe(true);
  });

  it("admits nobody without a person record", () => {
    expect(agentAudienceAdmits({ personId: null, workforceType: "employee", grants: [] } as unknown as Principal, "x@suzu.group", { audience: "everyone", pilotEmails: "" })).toBe(false);
  });
});

describe("what the app lets a model say in its own words (FR-AGT-03)", () => {
  it("shows nothing written without reading anything", () => {
    expect(isUngrounded(0)).toBe(true);
    expect(isUngrounded(1)).toBe(false);
  });

  it("shows a clarifying question only when it is one short question", () => {
    expect(isClarifyingQuestion("Bạn muốn xem dự án nào?")).toBe(true);
    expect(isClarifyingQuestion("Which month? ")).toBe(true);
    expect(isClarifyingQuestion("Here is a poem about summer.")).toBe(false);
    // Room to list what a form still needs (R4), and no more.
    expect(isClarifyingQuestion(`Đề nghị mua cần thêm: số tiền dự kiến, nhóm chi phí và ngày cần có — bạn cho mình biết nhé?`)).toBe(true);
    expect(isClarifyingQuestion(`${"x".repeat(520)}?`)).toBe(false);
    expect(isClarifyingQuestion("")).toBe(false);
    expect(isClarifyingQuestion(42)).toBe(false);
  });
});

describe("a request to act goes to the agent, not the free router (R4)", () => {
  it("knows a request to do something", () => {
    for (const question of ["Xin nghỉ phép năm thứ Sáu tuần sau", "Hôm qua tôi quên chấm công ra, về lúc 18:15", "Tạo việc thiết kế banner Tết cho Lan", "Ghi 2 tiếng hôm nay cho việc Dựng bản 3 phút", "Đăng ký làm từ xa ngày mai", "Nộp báo cáo cuối ngày giúp tôi", "Log 90 minutes of training today", "Please create a task to back up the archive", "Can you submit my end-of-day report?", "Request annual leave next Monday", "Put the opening graphics task on my plan for today", "Comment on the subtitles task that the script is missing", "Giao việc Mua bản quyền nhạc nền cho Huy", "Tạo đề nghị mua 2 ổ cứng 4TB"]) {
      expect(asksToAct(question), question).toBe(true);
    }
  });

  it("leaves a question about a figure to the router", () => {
    for (const question of ["Tôi còn bao nhiêu ngày phép?", "Tháng này tôi đi muộn mấy lần?", "Ai duyệt đơn nghỉ phép của tôi?", "Giải thích phiếu lương tháng 9 của tôi", "How many leave days do I have left?", "What's my attendance this month?"]) {
      expect(asksToAct(question), question).toBe(false);
    }
  });
});

describe("a turn that asks to act starts on the second tier (R4)", () => {
  it("starts on Sonnet with tools, and every other turn on Haiku", () => {
    expect(firstStep(true)).toEqual({ kind: "call", tier: "standard", withTools: true });
    expect(firstStep(false)).toEqual(FIRST_STEP);
  });
});
