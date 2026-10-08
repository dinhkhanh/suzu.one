// What happens to a page's passages the moment it is published, and what a real embeddings model
// is asked — against a real Postgres (PGlite), with the embeddings provider replaced by a recorder
// that behaves like the REAL driver (`isFake: false`): it can be slow, it can fail, and it is what
// retrieval ranks by. Nothing leaves the machine.
//
// The defects this file exists for (inspection AI-03):
//   1. a page published at nine was invisible to the assistant until the next twice-daily job;
//   2. the question was embedded as an accent-stripped keyword bag while pages are embedded as
//      accented prose.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn(async () => undefined), logError: vi.fn() }));
// The provider. Vectors are the local fake's (so "close" still means "shares words"), under a
// model name of its own; `provider` says whether it is up and whether it is the fake.
vi.mock("./embeddings", async () => {
  const { fakeEmbedding } = await import("./engine/fake-embedding");
  const embed = async (texts: readonly string[], kind: string) => {
    provider.calls.push({ texts: [...texts], kind });
    if (provider.down) throw new Error("embeddings: 503 unavailable");
    return texts.map(fakeEmbedding);
  };
  const embeddingDriver = () => ({ model: provider.fake ? "fake-hash-256" : "test-real-model", isFake: provider.fake, batchSize: 2, embed });
  return {
    embeddingDriver,
    embedTexts: async (texts: readonly string[], kind: string) => {
      const driver = embeddingDriver();
      const vectors: number[][] = [];
      for (let at = 0; at < texts.length; at += driver.batchSize) vectors.push(...(await driver.embed(texts.slice(at, at + driver.batchSize), kind)));
      return { model: driver.model, vectors };
    },
  };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reportError } from "@/lib/observability/report";
import { doc, heading, paragraph } from "@/modules/platform/rich-text/engine/build";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { embedPendingChunks, embedPublishedPage, retrieveKbChunks } from "./chunks";
import { createPage, publishPage, saveDraft } from "./pages";
import { type KbViewer, viewerKeys } from "./policy";
import { createSpace } from "./spaces";

const provider = { calls: [] as { texts: string[]; kind: string }[], down: false, fake: false };
const ids = {} as Record<"hr" | "huy" | "space", string>;
let viewer: KbViewer;

const chunksOf = (pageId: string) => db().select().from(schema.kbPageChunk).where(eq(schema.kbPageChunk.pageId, pageId)).orderBy(schema.kbPageChunk.chunkIndex);
const publish = async (title: string, ...sections: [string, string][]) => {
  const page = await createPage({ spaceId: ids.space, parentId: null, title, content: doc(...sections.flatMap(([name, text]) => [heading(1, name), paragraph(text)])) }, { personId: ids.hr });
  await publishPage(page.id, { personId: ids.hr });
  return page.id;
};

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  for (const key of ["hr", "huy"] as const) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", workforceType: "employee", primaryEntityId: entity.id })
      .returning();
    ids[key] = row.id;
  }
  const principal: Principal = { personId: ids.huy, workforceType: "employee", grants: [] };
  viewer = { principal, personId: ids.huy, keys: viewerKeys(principal, { entityId: entity.id, unitId: null, unitPath: [] }) };
  ids.space = (await createSpace({ key: "so-tay", name: "Sổ tay", description: null, icon: null, entityId: null, kind: "open", sortOrder: 0 }, ids.hr, [{ subjectKey: "all", level: "view" }])).id;
});

beforeEach(() => {
  provider.calls.length = 0;
  provider.down = false;
  provider.fake = false;
  vi.mocked(reportError).mockClear();
});

describe("right after a publish", () => {
  it("embeds the page's own new passages, so retrieval ranks it at once — and leaves other pages to the job", async () => {
    const other = await publish("Gửi xe máy", ["Bãi xe", "Gửi xe máy ở tầng hầm B2, xuất trình thẻ nhân viên."]);
    const page = await publish("Nghỉ chăm con ốm", ["Điều kiện", "Con dưới 7 tuổi ốm thì bố hoặc mẹ được nghỉ chăm con."], ["Thủ tục", "Nộp giấy ra viện cho phòng Nhân sự trong 5 ngày."]);
    // Just published: no vector, so retrieval can only list it after everything ranked, at score 0.
    expect((await chunksOf(page)).every((chunk) => chunk.embeddingVector === null)).toBe(true);
    provider.calls.length = 0;

    expect(await embedPublishedPage(page)).toEqual({ embedded: 2, deferred: false });
    expect((await chunksOf(page)).every((chunk) => chunk.embeddingModel === "test-real-model" && chunk.embeddingVector !== null)).toBe(true);
    // One call of the provider (two passages, a batch of two), as documents, and only this page's.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].kind).toBe("document");
    expect(provider.calls[0].texts.join("\n")).not.toContain("tầng hầm");
    expect((await chunksOf(other)).every((chunk) => chunk.embeddingVector === null)).toBe(true);

    const [best] = await retrieveKbChunks(viewer, { query: "nghi cham con om", limit: 3 });
    expect(best).toMatchObject({ pageId: page, pageTitle: "Nghỉ chăm con ốm" });
    expect(best.score).toBeGreaterThan(0.2);
    // Nothing left to do for it: a second run embeds nothing and calls nobody.
    provider.calls.length = 0;
    expect(await embedPublishedPage(page)).toEqual({ embedded: 0, deferred: false });
    expect(provider.calls).toHaveLength(0);
  });

  it("embeds only what an edit changed: a passage that kept its words kept its vector", async () => {
    const page = await publish("Thẻ nhân viên", ["Cấp thẻ", "Thẻ được cấp trong tuần đầu tiên."], ["Mất thẻ", "Báo phòng Hành chính để cấp lại."]);
    await embedPublishedPage(page);
    await saveDraft(
      page,
      { title: "Thẻ nhân viên", content: doc(heading(1, "Cấp thẻ"), paragraph("Thẻ được cấp trong tuần đầu tiên."), heading(1, "Mất thẻ"), paragraph("Báo phòng Hành chính trong 3 ngày để cấp lại.")) },
      { personId: ids.hr },
    );
    await publishPage(page, { personId: ids.hr });
    provider.calls.length = 0;
    expect(await embedPublishedPage(page)).toEqual({ embedded: 1, deferred: false });
    expect(provider.calls.flatMap((call) => call.texts)).toHaveLength(1);
    expect(provider.calls[0].texts[0]).toContain("3 ngày");
  });

  it("leaves a page with more new passages than the cap to the job, without calling the provider", async () => {
    const manual = await publish("Sổ tay quy trình", ["Một", "Bước một của quy trình."], ["Hai", "Bước hai của quy trình."], ["Ba", "Bước ba của quy trình."]);
    provider.calls.length = 0;
    expect(await embedPublishedPage(manual, 2)).toEqual({ embedded: 0, deferred: true });
    expect(provider.calls).toHaveLength(0);
    expect((await chunksOf(manual)).every((chunk) => chunk.embeddingVector === null)).toBe(true);
    // At the cap exactly, it is done there and then.
    expect(await embedPublishedPage(manual, 3)).toEqual({ embedded: 3, deferred: false });
  });

  it("never throws when the provider is down: the publish stands, the error is reported, the job catches up", async () => {
    const page = await publish("Đặt phòng họp", ["Cách đặt", "Đặt phòng họp trên lịch chung trước một ngày."]);
    provider.down = true;
    expect(await embedPublishedPage(page)).toEqual({ embedded: 0, deferred: true });
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0][1]).toMatchObject({ event: "kb.embed_after_publish.failed" });
    // The page is published and readable; its passages are simply still waiting.
    const [row] = await db().select().from(schema.kbPage).where(eq(schema.kbPage.id, page));
    expect(row.status).toBe("published");
    expect((await chunksOf(page)).every((chunk) => chunk.embeddingVector === null)).toBe(true);

    provider.down = false;
    expect((await embedPendingChunks()).remaining).toBe(0);
    expect((await chunksOf(page)).every((chunk) => chunk.embeddingModel === "test-real-model")).toBe(true);
  });
});

describe("what the question is embedded as", () => {
  const typed = "  Tôi nghỉ phép chăm con ốm được không?  ";
  const keywords = "nghi phep cham con om khong";

  it("gives a real model the question as typed — accents kept, trimmed — and keeps the keywords for the word match", async () => {
    await embedPendingChunks();
    provider.calls.length = 0;
    const found = await retrieveKbChunks(viewer, { query: keywords, question: typed, limit: 5 });
    expect(provider.calls).toEqual([{ texts: ["Tôi nghỉ phép chăm con ốm được không?"], kind: "query" }]);
    expect(found[0]).toMatchObject({ pageTitle: "Nghỉ chăm con ốm" });
  });

  it("caps a pasted wall of text before it is sent to be embedded", async () => {
    await retrieveKbChunks(viewer, { query: keywords, question: `${"Nghỉ phép chăm con ốm? ".repeat(200)}`, limit: 1 });
    expect(provider.calls[0].texts[0]).toHaveLength(1000);
  });

  it("embeds the query when no question is given, as every other caller does", async () => {
    await retrieveKbChunks(viewer, { query: "gửi xe máy ở đâu", limit: 1 });
    expect(provider.calls).toEqual([{ texts: ["gửi xe máy ở đâu"], kind: "query" }]);
  });

  it("keeps the keyword form for the local fake, which hashes words and reads no sentence", async () => {
    provider.fake = true;
    await retrieveKbChunks(viewer, { query: keywords, question: typed, limit: 1 });
    expect(provider.calls).toEqual([{ texts: [keywords], kind: "query" }]);
  });
});
