// What the assistant hands to the knowledge base's retrieval: two forms of one question, each to
// the half it suits (inspection AI-03 — the question used to be embedded as the keyword bag).
import { describe, expect, it, vi } from "vitest";

type Input = { query: string; question?: string; limit?: number; spaceId?: string | null };
const retrieveKbChunks = vi.fn<(viewer: unknown, input: Input) => Promise<never[]>>(async () => []);
vi.mock("@/modules/kb/service", () => ({ retrieveKbChunks: (viewer: unknown, input: Input) => retrieveKbChunks(viewer, input) }));

import type { KbViewer } from "@/modules/kb/service";
import { CANDIDATES, retrievePassages } from "./retrieval";

const viewer = { principal: { personId: "p", workforceType: "employee", grants: [] }, personId: "p", keys: [] } as unknown as KbViewer;

describe("the two forms of a question", () => {
  it("sends the question as typed for the vector, and its content words for the word match", async () => {
    const typed = "Tôi được nghỉ phép bao nhiêu ngày một năm?";
    await retrievePassages(viewer, typed);
    const [asViewer, input] = retrieveKbChunks.mock.calls[0];
    expect(asViewer).toBe(viewer);
    expect(input.question).toBe(typed);
    // Accent-stripped, stop words gone — and nothing of "tôi", "được", "bao nhiêu".
    expect(input.query.split(" ")).toEqual(expect.arrayContaining(["nghi", "phep", "ngay", "nam"]));
    expect(input.query).not.toMatch(/toi|duoc|bao|nhieu|[À-ỹ]/);
    expect(input.limit).toBe(CANDIDATES);
  });

  it("widens the word match with the other language's words, and leaves the sentence alone", async () => {
    retrieveKbChunks.mockClear();
    await retrievePassages(viewer, "How many days of annual leave do I get?");
    const [, input] = retrieveKbChunks.mock.calls[0];
    expect(input.question).toBe("How many days of annual leave do I get?");
    expect(input.query.split(" ")).toEqual(expect.arrayContaining(["annual", "leave", "phep"]));
  });
});
