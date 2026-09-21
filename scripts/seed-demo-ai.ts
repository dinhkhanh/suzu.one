// Phase 9 demo data for the assistant, called from seed-demo.ts. Idempotent: skipped once any
// conversation exists. What it puts on screen, without a dev server and without a key:
//
//  - three conversations, one per kind of asker, each answered the way the local extractive driver
//    answers — the retrieval is REAL (it runs the same ranking over the seeded chunks, with the
//    asker's own permission keys), so the citations point at pages those people can actually open;
//  - a handful of questions nobody could answer, two of them asked by several people, so
//    /assistant/unanswered shows a backlog worth working through rather than an empty table.
//
// tsx cannot load `server-only` modules, so this file calls the pure engine (`modules/ai/engine`)
// and does the permission filter here with the same subject keys `kbViewerOf` builds. It is the
// one place in the repo that repeats that logic, and only because a seed script cannot import the
// service; the app itself has a single path.
import { eq, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { aiConversation, aiMessage, aiUnansweredQuestion, orgUnit, entity, kbAccess, kbPage, kbPageChunk, kbSpace, leaveLedgerEntry, leaveType, person, roleAssignment } from "../src/lib/db/schema";
import { extractAnswer, rankPassages, renderExtractedAnswer, type Passage } from "../src/modules/ai/engine/answer";
import { fakeEmbedding, cosine } from "../src/modules/kb/engine/fake-embedding";
import { retrievalQuery } from "../src/modules/ai/engine/question";

type Db = ReturnType<typeof drizzle>;

/** Asked, and answered from the knowledge base as that person can see it. */
const CHATS: { who: string; locale: "vi" | "en"; questions: string[] }[] = [
  { who: "Hồ Gia Huy", locale: "vi", questions: ["Một năm được bao nhiêu ngày phép năm?", "Nghỉ từ 5 ngày liên tục thì ai duyệt?", "Ngày trả lương là ngày nào?"] },
  { who: "Đặng Hoàng Long", locale: "vi", questions: ["Làm thêm vào ngày lễ tết được trả bao nhiêu phần trăm?", "Khách hàng duyệt kịch bản được mấy vòng sửa?"] },
  { who: "Võ Minh Tuấn", locale: "vi", questions: ["Hoàn ứng phải làm trong vòng bao nhiêu ngày?"] },
];

/** Asked, and not in the knowledge base — the backlog HR should write next. */
const MISSING: { who: string; locale: "vi" | "en"; question: string; times: number }[] = [
  { who: "Hồ Gia Huy", locale: "vi", question: "Công ty có hỗ trợ học phí khoá học tiếng Anh không?", times: 4 },
  { who: "Dương Thùy Chi", locale: "vi", question: "Chính sách thưởng giới thiệu ứng viên là bao nhiêu?", times: 3 },
  { who: "Lý Minh Khôi", locale: "vi", question: "Công ty có xe đưa đón nhân viên tuyến Biên Hoà không?", times: 1 },
  { who: "Đỗ Khánh Linh", locale: "vi", question: "Nhân viên thử việc có được đóng bảo hiểm sức khoẻ tư nhân không?", times: 2 },
  { who: "Trịnh Ngọc Ánh", locale: "en", question: "Is there a policy for taking unpaid study leave?", times: 1 },
];

export async function seedAi(db: Db): Promise<string> {
  const [existing] = await db.select({ id: aiConversation.id }).from(aiConversation).limit(1);
  if (existing) return "0 assistant conversations (already there)";

  const people = await db.select({ id: person.id, name: person.fullName, entityId: person.primaryEntityId, orgUnitId: person.orgUnitId, orgUnitPath: person.orgUnitPath, workforceType: person.workforceType, managerId: person.managerId }).from(person);
  const byName = new Map(people.map((row) => [row.name, row]));
  const grants = await db.select({ personId: roleAssignment.personId, role: roleAssignment.role }).from(roleAssignment);
  const rolesOf = new Map<string, string[]>();
  for (const grant of grants) rolesOf.set(grant.personId, [...(rolesOf.get(grant.personId) ?? []), grant.role]);

  // The subject keys `viewerKeys()` builds, repeated here because tsx cannot import it.
  const keysOf = (who: NonNullable<ReturnType<typeof byName.get>>) => (who.workforceType === "collaborator" ? [`person:${who.id}`] : [...new Set(["all", ...(who.entityId ? [`entity:${who.entityId}`] : []), ...who.orgUnitPath.map((unitId) => `unit:${unitId}`), ...(who.orgUnitId ? [`unit_only:${who.orgUnitId}`] : []), ...(rolesOf.get(who.id) ?? []).map((role) => `role:${role}`), `person:${who.id}`])]);

  // Every published chunk with what decides whether a given person may read it: the access rows of
  // its space, and those of its page's access root when the page sits in a restricted subtree.
  const chunks = await db
    .select({
      chunkId: kbPageChunk.id,
      pageId: kbPage.id,
      pageTitle: kbPage.publishedTitle,
      spaceId: kbSpace.id,
      spaceKey: kbSpace.key,
      spaceName: kbSpace.name,
      headingPath: kbPageChunk.headingPath,
      content: kbPageChunk.content,
      embedding: kbPageChunk.embedding,
      accessRootId: kbPage.accessRootId,
    })
    .from(kbPageChunk)
    .innerJoin(kbPage, eq(kbPage.id, kbPageChunk.pageId))
    .innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId))
    .where(sql`${kbPageChunk.versionId} = ${kbPage.publishedVersionId} and ${kbPage.deletedAt} is null and ${kbPage.status} <> 'archived' and ${kbSpace.archivedAt} is null`);

  const access = await db.select({ spaceId: kbAccess.spaceId, pageId: kbAccess.pageId, subjectKey: kbAccess.subjectKey }).from(kbAccess);
  const spaceKeys = new Map<string, string[]>();
  const pageKeys = new Map<string, string[]>();
  for (const row of access) {
    if (row.pageId) pageKeys.set(row.pageId, [...(pageKeys.get(row.pageId) ?? []), row.subjectKey]);
    else spaceKeys.set(row.spaceId, [...(spaceKeys.get(row.spaceId) ?? []), row.subjectKey]);
  }
  const mayRead = (keys: string[], chunk: (typeof chunks)[number]) => {
    if (!(spaceKeys.get(chunk.spaceId) ?? []).some((key) => keys.includes(key))) return false;
    if (!chunk.accessRootId) return true;
    return (pageKeys.get(chunk.accessRootId) ?? []).some((key) => keys.includes(key));
  };

  let answered = 0;
  let logged = 0;
  const now = new Date();
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  for (const [index, chat] of CHATS.entries()) {
    const who = byName.get(chat.who);
    if (!who) continue;
    const keys = keysOf(who);
    const visible = chunks.filter((chunk) => mayRead(keys, chunk));
    let conversationId: string | null = null;
    for (const [turn, question] of chat.questions.entries()) {
      const at = minutesAgo((CHATS.length - index) * 90 - turn * 4);
      const query = fakeEmbedding(retrievalQuery(question));
      const passages: Passage[] = visible.map((chunk) => ({ chunkId: chunk.chunkId, pageId: chunk.pageId, pageTitle: chunk.pageTitle ?? "", spaceKey: chunk.spaceKey, spaceName: chunk.spaceName, headingPath: chunk.headingPath, content: chunk.content, vectorScore: chunk.embedding ? cosine(query, chunk.embedding) : 0 }));
      const ranked = rankPassages(question, passages);
      const extracted = extractAnswer(question, ranked);
      const body = renderExtractedAnswer(extracted);
      const citations = extracted.passages.map((passage) => passage.citation);

      if (!conversationId) {
        const [row] = await db.insert(aiConversation).values({ personId: who.id, title: question.slice(0, 120), locale: chat.locale, createdAt: at, updatedAt: at }).returning();
        conversationId = row.id;
      } else {
        await db.update(aiConversation).set({ updatedAt: at }).where(eq(aiConversation.id, conversationId));
      }
      await db.insert(aiMessage).values({ conversationId, personId: who.id, role: "user", body: question, createdAt: at });
      const [stored] = await db
        .insert(aiMessage)
        .values({ conversationId, personId: who.id, role: "assistant", body, outcome: citations.length > 0 ? "answered" : "unanswered", citations, driver: "local-extractive", model: "local-extractive", score: ranked[0]?.score ?? 0, createdAt: new Date(at.getTime() + 2000) })
        .returning();
      if (citations.length === 0) await db.insert(aiUnansweredQuestion).values({ personId: who.id, messageId: stored.id, question, locale: chat.locale, bestScore: ranked[0]?.score ?? 0, createdAt: at });
      answered++;
    }
  }

  // ── The personal tools (FR-AI-02) ─────────────────────────────────────────────────────────
  // Two turns that show the assistant answering from the asker's OWN record rather than from a
  // page, so the demo has one of each on screen. The figures are the seeded ledger's, worked out
  // here the way `leave/ledger.ts` works them out; the payslip explanation needs a published
  // payslip and is demonstrated live after `pnpm db:seed:demo:payroll`, not seeded.
  const balanceRows = await db
    .select({ personId: leaveLedgerEntry.personId, code: leaveType.code, name: leaveType.name, nameEn: leaveType.nameEn, balance: sql<number>`sum(${leaveLedgerEntry.amountCenti})::int` })
    .from(leaveLedgerEntry)
    .innerJoin(leaveType, eq(leaveType.id, leaveLedgerEntry.leaveTypeId))
    .where(sql`${leaveType.tracksBalance} and ${leaveLedgerEntry.leaveYear} = ${now.getFullYear()}`)
    .groupBy(leaveLedgerEntry.personId, leaveType.code, leaveType.name, leaveType.nameEn);

  const toolTurn = async (whoName: string, question: string, tool: string, result: Record<string, unknown>, minutes: number) => {
    const who = byName.get(whoName);
    if (!who) return;
    const at = minutesAgo(minutes);
    const [row] = await db.insert(aiConversation).values({ personId: who.id, title: question.slice(0, 120), locale: "vi", createdAt: at, updatedAt: at }).returning();
    await db.insert(aiMessage).values({ conversationId: row.id, personId: who.id, role: "user", body: question, createdAt: at });
    await db.insert(aiMessage).values({ conversationId: row.id, personId: who.id, role: "assistant", body: "", outcome: "answered", citations: [], tool, toolResult: { status: "answered", tool, ...result }, driver: "tool", model: tool, score: 0, createdAt: new Date(at.getTime() + 1500) });
    answered++;
  };

  const huy = byName.get("Hồ Gia Huy");
  const huyBalances = balanceRows.filter((row) => row.personId === huy?.id);
  if (huyBalances.length > 0) {
    const annual = huyBalances.find((row) => row.code === "ANNUAL") ?? huyBalances[0];
    const days = (centi: number) => Math.round(centi) / 100;
    await toolTurn("Hồ Gia Huy", "Tôi còn bao nhiêu ngày phép?", "leave_balance", {
      key: "summary",
      params: { year: String(now.getFullYear()), code: annual.code, available: days(annual.balance), used: 0, pending: 0 },
      lines: huyBalances.map((row) => ({ key: "type", params: { name: row.name, nameEn: row.nameEn ?? row.name, available: days(row.balance), used: 0, pending: 0 } })),
      link: "/leave",
    }, 38);
  }

  const manager = huy?.managerId ? people.find((row) => row.id === huy.managerId) : undefined;
  if (manager) {
    await toolTurn("Hồ Gia Huy", "Ai duyệt đơn nghỉ phép của tôi?", "approver_lookup", {
      key: "summary",
      params: { kind: "leave", first: manager.name },
      lines: [{ key: "step", params: { step: "manager", names: manager.name } }],
      link: "/leave/new",
    }, 34);
  }

  // The backlog. The same question from several people is several rows — the log groups them.
  const askers = people.filter((row) => row.workforceType !== "collaborator");
  for (const [index, missing] of MISSING.entries()) {
    for (let copy = 0; copy < missing.times; copy++) {
      const asker = copy === 0 ? (byName.get(missing.who) ?? askers[0]) : askers[(index * 3 + copy * 5) % askers.length];
      await db.insert(aiUnansweredQuestion).values({ personId: asker.id, question: missing.question, locale: missing.locale, bestScore: 0.12 + ((index * 7 + copy * 3) % 18) / 100, createdAt: minutesAgo(60 * 24 * (index + 1) + copy * 47) });
      logged++;
    }
  }

  // One already dealt with, so the "All" tab is not a copy of the "Open" one.
  const hr = byName.get("Lê Thị Mai");
  if (hr) {
    const [done] = await db.insert(aiUnansweredQuestion).values({ personId: askers[0].id, question: "Quy định về trang phục khi đi gặp khách hàng?", locale: "vi", bestScore: 0.2, createdAt: minutesAgo(60 * 24 * 9) }).returning();
    await db.update(aiUnansweredQuestion).set({ resolvedAt: minutesAgo(60 * 24 * 2), resolvedByPersonId: hr.id, resolutionNote: "Đã bổ sung mục Trang phục vào trang Quy tắc ứng xử." }).where(inArray(aiUnansweredQuestion.id, [done.id]));
    logged++;
  }

  // Keep the demo honest: departments and entities are referenced above only through the keys.
  void orgUnit;
  void entity;
  return `${answered} answered assistant turns (knowledge base and the personal tools) and ${logged} unanswered questions`;
}
