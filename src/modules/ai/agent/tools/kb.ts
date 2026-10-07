// The handbook as a tool (FR-AGT-19), so one answer can put a policy beside the asker's own
// figure ("12 ngày phép năm; bạn còn 7"). The same retrieval as Phase 9 — `retrievePassages` with
// the asker's own KB viewer, whose WHERE clause is the permission check — and the same ranking and
// excerpts. What goes to the model passes `passageForModel`: no contact detail, no amount of money.
// The citations shown under the answer are the passages retrieved, never links parsed from what the
// model wrote.
import "server-only";
import { z } from "zod";
import { kbViewerOf } from "@/modules/kb/service";
import { citationHref, type Citation, extractAnswer } from "../../engine/answer";
import { passageForModel } from "../../engine/redact";
import { retrievePassages } from "../../retrieval";
import { type AnyAgentTool, defineTool, type ToolResult } from "../registry";

const handbook = defineTool({
  name: "search_handbook",
  module: "kb",
  description:
    "Searches the company handbook and knowledge base the asker may read: policies, procedures, benefits, rules, and how-to guides for SuZu One. Returns up to three passages with their page and a link. Write the query as the asker would ask it, in their language.",
  input: z.strictObject({ query: z.string().min(2).max(300).describe("What to look for, as a short question or phrase.") }),
  offeredTo: (principal) => principal.personId !== null,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: 3,
  tags: [],
  run: async ({ user }, input): Promise<ToolResult & { citations: Citation[] }> => {
    const ranked = await retrievePassages(kbViewerOf(user), input.query);
    const { passages } = extractAnswer(input.query, ranked);
    if (passages.length === 0) return { outcome: "empty", model: { query: input.query, passages: [], link: "/kb" }, card: null, subject: null, citations: [] };
    return {
      outcome: "answered",
      model: {
        passages: passages.map(({ citation, excerpt }) => ({
          page: passageForModel(citation.pageTitle),
          section: passageForModel(citation.headingPath),
          href: citationHref(citation),
          text: passageForModel(excerpt),
        })),
      },
      // The passages are shown as the chat's sources, not as a card.
      card: null,
      subject: { type: "kb_page", id: passages[0].citation.pageId },
      citations: passages.map((passage) => passage.citation),
    };
  },
});

export const KB_TOOLS: readonly AnyAgentTool[] = [handbook];
