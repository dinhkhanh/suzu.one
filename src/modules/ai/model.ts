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
//
// WHAT A CLAUDE DRIVER SENDS is decided in `engine/redact.ts` and nowhere else: each of the two
// builds its request from `chatRequestForModel` / `draftRequestForModel`, so no passage, thread or
// question reaches the network with a contact detail in it, and no passage or thread with an
// amount of money. The request a driver would send is tested with the network replaced
// (`model.test.ts`). Every answer says what it cost (`usage`), which `ask` stores on the message
// and a draft keeps in its audit entry.
import "server-only";
import { env } from "@/lib/env";
import { citationHref, type ExtractedAnswer, extractAnswer, type RankedPassage, renderExtractedAnswer } from "./engine/answer";
import { NO_USAGE, type TokenUsage, usageOf } from "./engine/limits";
import { assemblePrompt, type PromptSource } from "./engine/prompt";
import { chatRequestForModel, draftRequestForModel } from "./engine/redact";

export type ChatRequest = {
  question: string;
  /** Already permission-filtered and ranked. The driver may only use these. */
  passages: readonly RankedPassage[];
  locale: string;
  /** The app screens this asker may be linked to, labelled in their language. */
  links?: readonly { label: string; href: string }[];
};

export type ChatAnswer = {
  /** Empty when the driver has nothing to say — the caller logs the question as unanswered. */
  body: string;
  extracted: ExtractedAnswer;
  /** Tokens in and out as the provider reported them; zero when nothing was sent to a model. */
  usage: TokenUsage;
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
    // Nothing is sent anywhere, so nothing was spent: zero, not an estimate.
    return { body: renderExtractedAnswer(extracted), extracted, usage: NO_USAGE };
  },
};

/** How many passages a real model is given. Enough to answer, few enough to stay cheap and focused. */
const CLAUDE_SOURCES = 6;

function claudeDriver(apiKey: string, model: string): ChatDriver {
  return {
    name: "claude",
    isLocal: false,
    model,
    complete: async ({ question, passages, links = [] }) => {
      // The citations are decided HERE, from what was retrieved — never parsed out of what the
      // model wrote. A model that cites a page it was not given, or invents one, changes nothing:
      // the links under the answer are the passages the asker's own permissions produced.
      const extracted = extractAnswer(question, passages);
      // FR-AI-06: the prompt is built from what `chatRequestForModel` hands back and from nothing
      // else — no contact detail and no amount of money in a passage, whichever page it is from.
      const outbound = chatRequestForModel({ question, passages: passages.slice(0, CLAUDE_SOURCES) });
      const sources: PromptSource[] = outbound.passages.map((passage, index) => ({ index: index + 1, pageTitle: passage.pageTitle, spaceName: passage.spaceName, headingPath: passage.headingPath, href: citationHref(passage), content: passage.content }));
      const { system, user } = assemblePrompt(outbound.question, sources, links);

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
      const body = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[]; usage?: Record<string, unknown> };
      // Whatever came back was paid for, answer or not.
      const usage = usageOf(body.usage);
      // A safety decline is not an answer; it is a question the knowledge base did not resolve.
      if (body.stop_reason === "refusal") return { body: "", extracted: { passages: [] }, usage };
      const text = (body.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("")
        .trim();
      // No text, or nothing retrieved to stand behind it: treat as unanswered rather than show a
      // sentence with no source. Every answer in this module carries a citation or is not shown.
      if (!text || extracted.passages.length === 0) return { body: "", extracted: { passages: [] }, usage };
      return { body: text, extracted, usage };
    },
  };
}

export function chatDriver(): ChatDriver {
  const { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: model } = env();
  return apiKey ? claudeDriver(apiKey, model) : localDriver;
}

// ── Drafting (FR-PJM-64) ────────────────────────────────────────────────────────────────────
//
// The same two drivers for the drafting helpers. The local driver has nothing to add: the caller
// already holds the extractive draft (`engine/drafts.ts`) and uses it. The Claude driver is given
// the facts — already permission-checked, and passed through `draftRequestForModel` on its own
// first line, so no caller can send a thread's phone numbers or a sentence about pay by forgetting
// a step — and asked to write them up. Like the chat driver it is **unverified until run against a
// real key**, and any failure, refusal or empty answer falls back to the extractive draft, never to
// an error the person has to understand. Nothing a driver returns is saved: the person edits and
// submits. What a call cost comes back with it, and is kept in the draft's audit entry.

export type DraftRequest = {
  /** What to write, in one or two sentences. */
  instruction: string;
  /** The recorded facts, as plain text. The only material the model may use. */
  facts: string;
  locale: string;
  /** When set, the answer must be JSON of this shape (structured output). */
  schema?: Record<string, unknown>;
};

/** `text` is null when the driver has nothing usable — the caller keeps its extractive draft. */
export type DraftAnswer = { text: string | null; usage: TokenUsage };

export type DraftDriver = { name: string; isLocal: boolean; model: string; draft: (request: DraftRequest) => Promise<DraftAnswer> };

const DRAFT_SYSTEM = [
  "You draft short work texts for employees of a Vietnamese agency, who will edit them before anyone sees them.",
  "Use only the facts you are given. Do not add tasks, people, dates, numbers or opinions that are not in the facts.",
  "Never write about pay, salaries, bonuses or amounts of money, and never write a phone number, an email address or a chat handle; where the facts show […], something was withheld — leave it out and do not guess it.",
  "Write plainly, without headings or greetings.",
].join(" ");

const localDraftDriver: DraftDriver = { name: LOCAL_DRIVER_NAME, isLocal: true, model: LOCAL_DRIVER_NAME, draft: async () => ({ text: null, usage: NO_USAGE }) };

function claudeDraftDriver(apiKey: string, model: string): DraftDriver {
  return {
    name: "claude",
    isLocal: false,
    model,
    draft: async (request) => {
      // FR-AI-06, SRS §4.15 rule 4: contact details, sentences about pay and amounts of money are
      // taken out here, whoever called and whatever they already did.
      const { instruction, facts, locale, schema } = draftRequestForModel(request);
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: 2000,
            system: DRAFT_SYSTEM,
            // A short rewrite of a few recorded facts: low effort is enough, and quick.
            output_config: { effort: "low", ...(schema ? { format: { type: "json_schema", schema } } : {}) },
            messages: [{ role: "user", content: `${instruction}\nLanguage: ${locale === "en" ? "English" : "Vietnamese"}.\n\n<facts>\n${facts}\n</facts>` }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) return { text: null, usage: NO_USAGE };
        const body = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[]; usage?: Record<string, unknown> };
        // A refusal or a cut-off draft is thrown away, and was still paid for.
        const usage = usageOf(body.usage);
        if (body.stop_reason === "refusal" || body.stop_reason === "max_tokens") return { text: null, usage };
        const text = (body.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("")
          .trim();
        return { text: text || null, usage };
      } catch {
        return { text: null, usage: NO_USAGE };
      }
    },
  };
}

export function draftDriver(): DraftDriver {
  const { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: model } = env();
  return apiKey ? claudeDraftDriver(apiKey, model) : localDraftDriver;
}
