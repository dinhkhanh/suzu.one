// The model adapter (FR-AI-01, 06). One function, two drivers — the shape `kb/embeddings.ts` uses:
//
//  - no `ANTHROPIC_API_KEY` → the LOCAL EXTRACTIVE DRIVER. It generates nothing. It ranks the
//    passages retrieval found and answers with the knowledge base's own words plus the citations.
//    Deterministic, offline, and the driver everything in this module is built and tested on: the
//    retrieval, the permission filter, the citations, the unanswered log and the evaluation set all
//    work with no key anywhere. An extractive answer is also the safest possible failure mode — it
//    cannot invent a rule that HR never wrote.
//
//  - key set → the CLAUDE DRIVER, written against the Messages API and **NEVER RUN**: the company
//    has no key. Model, endpoint, headers and body shape follow the current API (Opus 5: adaptive
//    thinking is on by default, `budget_tokens` is rejected, effort lives in `output_config`).
//    It is written with `fetch` rather than `@anthropic-ai/sdk` on purpose, the way the Voyage,
//    Resend and Google Calendar drivers in this codebase are: an untested path should not add a
//    runtime dependency, and the request here is one POST with no streaming and no tool loop.
//    Treat every line of it as unverified until somebody runs it against a real key.
//
// FR-AI-06's "zero-data-retention provider setting" is not a request parameter — it is a property
// of the Anthropic organisation the key belongs to. It is listed under "Needs the owner".
import "server-only";
import { env } from "@/lib/env";
import { type ExtractedAnswer, extractAnswer, type RankedPassage, renderExtractedAnswer } from "./engine/answer";
import { assemblePrompt, type PromptSource } from "./engine/prompt";

export type ChatRequest = {
  question: string;
  /** Already permission-filtered and ranked. The driver may only use these. */
  passages: readonly RankedPassage[];
  locale: string;
};

export type ChatAnswer = {
  /** Empty when the driver has nothing to say — the caller logs the question as unanswered. */
  body: string;
  extracted: ExtractedAnswer;
};

export type ChatDriver = {
  name: string;
  isLocal: boolean;
  model: string;
  complete: (request: ChatRequest) => Promise<ChatAnswer>;
};

export const LOCAL_DRIVER_NAME = "local-extractive";

const localDriver: ChatDriver = {
  name: LOCAL_DRIVER_NAME,
  isLocal: true,
  model: LOCAL_DRIVER_NAME,
  complete: async ({ question, passages }) => {
    const extracted = extractAnswer(question, passages);
    return { body: renderExtractedAnswer(extracted), extracted };
  },
};

/** How many passages a real model is given. Enough to answer, few enough to stay cheap and focused. */
const CLAUDE_SOURCES = 6;

function claudeDriver(apiKey: string, model: string): ChatDriver {
  return {
    name: "claude",
    isLocal: false,
    model,
    complete: async ({ question, passages }) => {
      // The citations are decided HERE, from what was retrieved — never parsed out of what the
      // model wrote. A model that cites a page it was not given, or invents one, changes nothing:
      // the links under the answer are the passages the asker's own permissions produced.
      const extracted = extractAnswer(question, passages);
      const used = passages.slice(0, CLAUDE_SOURCES);
      const sources: PromptSource[] = used.map((passage, index) => ({ index: index + 1, pageTitle: passage.pageTitle, spaceName: passage.spaceName, headingPath: passage.headingPath, content: passage.content }));
      const { system, user } = assemblePrompt(question, sources);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 1500,
          system,
          // Thinking is adaptive by default on Opus 5; `output_config.effort` is the dial. A grounded
          // answer out of six short passages is not a hard problem — "low" keeps it quick and cheap.
          output_config: { effort: "low" },
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`assistant: ${response.status} ${(await response.text()).slice(0, 200)}`);
      const body = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
      // A safety decline is not an answer; it is a question the knowledge base did not resolve.
      if (body.stop_reason === "refusal") return { body: "", extracted: { passages: [] } };
      const text = (body.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("")
        .trim();
      // No text, or nothing retrieved to stand behind it: treat as unanswered rather than show a
      // sentence with no source. Every answer in this module carries a citation or is not shown.
      if (!text || extracted.passages.length === 0) return { body: "", extracted: { passages: [] } };
      return { body: text, extracted };
    },
  };
}

export function chatDriver(): ChatDriver {
  const { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: model } = env();
  return apiKey ? claudeDriver(apiKey, model) : localDriver;
}
