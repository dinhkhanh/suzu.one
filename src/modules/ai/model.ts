// The model adapter (FR-AI-01, 06). One function, two drivers — the shape `kb/embeddings.ts` uses:
//
//  - no `ANTHROPIC_API_KEY` → the LOCAL EXTRACTIVE DRIVER. It generates nothing. It ranks the
//    passages retrieval found and answers with the knowledge base's own words plus the citations.
//    Deterministic, offline, and the driver everything in this module is built and tested on: the
//    retrieval, the permission filter, the citations, the unanswered log and the evaluation set all
//    work with no key anywhere. An extractive answer is also the safest possible failure mode — it
//    cannot invent a rule that HR never wrote.
//
//  - key set → the CLAUDE DRIVER, on the official SDK through `gateway.ts` — the one door that
//    admits a call against the kill switch and the budget, sends it on its tier's model and records
//    what it cost (SRS D35, D38). A handbook answer and a draft are simple work: they run on the
//    SIMPLE tier (Haiku). When the gateway refuses — switched off, budget spent, provider down — the
//    driver answers as the local one would and says why (`notice`), so a refusal is never an error.
//
// The key is the owner's own Anthropic account (D38): its standard retention applies, not zero data
// retention, which the owner accepted (NFR-AGT-04).
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
import { NO_USAGE, type TokenUsage } from "./engine/limits";
import { assemblePrompt, type PromptSource } from "./engine/prompt";
import { chatRequestForModel, draftRequestForModel } from "./engine/redact";
import { callModel, type ModelPurpose, modelFor, textOf } from "./gateway";
import type { AiNotice, ModelAsker } from "./spend";

export type ChatRequest = {
  /** Whose question it is: their budget is spent, their band decides the allowance. */
  asker: ModelAsker;
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
  /** Who answered: the driver and model that wrote `body` — the local one when the gateway refused. */
  driver: string;
  model: string;
  /** Why a model did not answer, when the driver has a key and still answered the free way. */
  notice: AiNotice | null;
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
  complete: async ({ question, passages }) => localAnswer(question, passages, null),
};

/** The free answer: the best passage, quoted with its citation. Nothing is sent, nothing is spent. */
function localAnswer(question: string, passages: readonly RankedPassage[], notice: AiNotice | null): ChatAnswer {
  const extracted = extractAnswer(question, passages);
  return { body: renderExtractedAnswer(extracted), extracted, usage: NO_USAGE, driver: LOCAL_DRIVER_NAME, model: LOCAL_DRIVER_NAME, notice };
}

/** How many passages a real model is given. Enough to answer, few enough to stay cheap and focused. */
const CLAUDE_SOURCES = 6;

function claudeDriver(): ChatDriver {
  const model = modelFor("simple");
  return {
    name: "claude",
    isLocal: false,
    model,
    complete: async ({ asker, question, passages, links = [] }) => {
      // The citations are decided HERE, from what was retrieved — never parsed out of what the
      // model wrote. A model that cites a page it was not given, or invents one, changes nothing:
      // the links under the answer are the passages the asker's own permissions produced.
      const extracted = extractAnswer(question, passages);
      // Nothing retrieved: there is nothing a model may answer from, so nothing is sent or spent.
      if (extracted.passages.length === 0) return localAnswer(question, passages, null);
      // FR-AI-06: the prompt is built from what `chatRequestForModel` hands back and from nothing
      // else — no contact detail and no amount of money in a passage, whichever page it is from.
      const outbound = chatRequestForModel({ question, passages: passages.slice(0, CLAUDE_SOURCES) });
      const sources: PromptSource[] = outbound.passages.map((passage, index) => ({ index: index + 1, pageTitle: passage.pageTitle, spaceName: passage.spaceName, headingPath: passage.headingPath, href: citationHref(passage), content: passage.content }));
      const { system, user } = assemblePrompt(outbound.question, sources, links);
      // A grounded answer out of six short passages is simple work (D38): the simple tier, low effort where the model takes it.
      const result = await callModel({ asker, purpose: "ask", tier: "simple", effort: "low", timeoutMs: 45_000, request: { max_tokens: 1500, system, messages: [{ role: "user", content: user }] } });
      if (!result.ok) return localAnswer(question, passages, result.notice);
      // A safety decline is not an answer; it is a question the knowledge base did not resolve.
      // Whatever came back was paid for, answer or not.
      const text = result.message.stop_reason === "refusal" ? "" : textOf(result.message);
      // No text: treat as unanswered rather than show a sentence with no source. Every answer in
      // this module carries a citation or is not shown.
      if (!text) return { body: "", extracted: { passages: [] }, usage: result.usage, driver: "claude", model: result.model, notice: null };
      return { body: text, extracted, usage: result.usage, driver: "claude", model: result.model, notice: null };
    },
  };
}

/** The Claude driver when there is a key — it still answers the free way when the gateway refuses. */
export function chatDriver(): ChatDriver {
  return env().ANTHROPIC_API_KEY ? claudeDriver() : localDriver;
}

// ── Drafting (FR-PJM-64) ────────────────────────────────────────────────────────────────────
//
// The same two drivers for the drafting helpers, on the simple tier and through the same gateway.
// The local driver has nothing to add: the caller already holds the extractive draft
// (`engine/drafts.ts`) and uses it. The Claude driver is given
// the facts — already permission-checked, and passed through `draftRequestForModel` on its own
// first line, so no caller can send a thread's phone numbers or a sentence about pay by forgetting
// a step — and asked to write them up. Like the chat driver it is **unverified until run against a
// real key**, and any failure, refusal or empty answer falls back to the extractive draft, never to
// an error the person has to understand. Nothing a driver returns is saved: the person edits and
// submits. What a call cost comes back with it, and is kept in the draft's audit entry.

export type DraftRequest = {
  asker: ModelAsker;
  purpose: Extract<ModelPurpose, `draft.${string}`>;
  /** What to write, in one or two sentences. */
  instruction: string;
  /** The recorded facts, as plain text. The only material the model may use. */
  facts: string;
  locale: string;
  /** When set, the answer must be JSON of this shape (structured output). */
  schema?: Record<string, unknown>;
};

/** `text` is null when the driver has nothing usable — the caller keeps its extractive draft. */
export type DraftAnswer = { text: string | null; usage: TokenUsage; /** Why no model wrote it, when the gateway refused. */ notice?: AiNotice | null };

export type DraftDriver = { name: string; isLocal: boolean; model: string; draft: (request: DraftRequest) => Promise<DraftAnswer> };

const DRAFT_SYSTEM = [
  "You draft short work texts for employees of a Vietnamese agency, who will edit them before anyone sees them.",
  "Use only the facts you are given. Do not add tasks, people, dates, numbers or opinions that are not in the facts.",
  "Never write about pay, salaries, bonuses or amounts of money, and never write a phone number, an email address or a chat handle; where the facts show […], something was withheld — leave it out and do not guess it.",
  "Write plainly, without headings or greetings.",
].join(" ");

const localDraftDriver: DraftDriver = { name: LOCAL_DRIVER_NAME, isLocal: true, model: LOCAL_DRIVER_NAME, draft: async () => ({ text: null, usage: NO_USAGE }) };

function claudeDraftDriver(): DraftDriver {
  const model = modelFor("simple");
  return {
    name: "claude",
    isLocal: false,
    model,
    draft: async (request) => {
      // FR-AI-06, SRS §4.15 rule 4: contact details, sentences about pay and amounts of money are
      // taken out here, whoever called and whatever they already did.
      const { instruction, facts, locale, schema } = draftRequestForModel(request);
      const result = await callModel({
        asker: request.asker,
        purpose: request.purpose,
        // A short rewrite of a few recorded facts: simple work, low effort where the model takes it.
        tier: "simple",
        effort: "low",
        timeoutMs: 30_000,
        ...(schema ? { format: { type: "json_schema" as const, schema } } : {}),
        request: { max_tokens: 2000, system: DRAFT_SYSTEM, messages: [{ role: "user", content: `${instruction}\nLanguage: ${locale === "en" ? "English" : "Vietnamese"}.\n\n<facts>\n${facts}\n</facts>` }] },
      });
      if (!result.ok) return { text: null, usage: NO_USAGE, notice: result.notice };
      // A refusal or a cut-off draft is thrown away, and was still paid for.
      if (result.message.stop_reason === "refusal" || result.message.stop_reason === "max_tokens") return { text: null, usage: result.usage };
      return { text: textOf(result.message) || null, usage: result.usage };
    },
  };
}

export function draftDriver(): DraftDriver {
  return env().ANTHROPIC_API_KEY ? claudeDraftDriver() : localDraftDriver;
}
