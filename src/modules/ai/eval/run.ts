// Running the evaluation set (the Phase 9 exit criterion: ≥85% answered correctly with a correct
// citation). Development only — it runs against the seeded demo company.
//
// It measures `answerQuestion`, the function that answers real people, as four seeded personas, so
// the permission filter is part of what is measured: a question is scored wrong if it quotes a
// page that asker may not open, and the "forbidden" questions exist for nothing else.
//
// WHAT A SCORE HERE DOES AND DOES NOT PROVE. It proves retrieval: that the right passage of the
// right page comes back for a question phrased the way a person would phrase it, and that it comes
// back only for people entitled to it. It proves nothing about a model's prose, because on the
// local driver there is none — the answer IS the passage. With a key, the citations stay exactly
// as measured here (they are chosen from retrieval, never parsed out of the model's text) and the
// sentences around them become the model's, which this set does not test.
import "server-only";
import { toSearchKey } from "@/lib/text";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { kbViewerOf } from "@/modules/kb/service";
import { loadGrants } from "@/modules/platform/rbac/service";
import { answerQuestion } from "../conversations";
import { chatDriver } from "../model";
import { EVAL_QUESTIONS, type EvalQuestion, type EvalWho } from "./questions";

const EMAILS: Record<EvalWho, string> = {
  huy: "huy.ho@suzu.group",
  tuan: "tuan.vo@suzu.group",
  long: "long.dang@suzu.group",
  thu: "ha.nguyen@suzu.vn",
};

export type EvalOutcome = {
  id: string;
  who: EvalWho;
  locale: string;
  kind: EvalQuestion["kind"];
  question: string;
  pass: boolean;
  /** Why it failed, in a few words. */
  problem: string | null;
  citedPage: string | null;
  score: number;
};

export type EvalReport = {
  driver: string;
  model: string;
  embeddingModel: string;
  total: number;
  passed: number;
  /** The headline, 0..100. */
  percent: number;
  byKind: Record<string, { total: number; passed: number }>;
  byLocale: Record<string, { total: number; passed: number }>;
  /** Of the `answer` questions: how often the right page was cited at all, not necessarily first. */
  citedAnywhere: number;
  /** Calibration: the weakest correct answer, and the strongest thing that should have been refused. */
  lowestCorrect: number;
  highestWronglyAnswered: number;
  failures: EvalOutcome[];
};

const has = (haystack: string, needle: string) => toSearchKey(haystack).includes(toSearchKey(needle));

async function viewerFor(who: EvalWho) {
  const email = EMAILS[who];
  const [person] = await db().select().from(schema.person).where(eq(schema.person.workEmail, email)).limit(1);
  if (!person) throw new Error(`eval: no seeded person for ${email} — run pnpm db:seed && pnpm db:seed:demo`);
  return kbViewerOf({ person, principal: { personId: person.id, workforceType: person.workforceType, grants: await loadGrants(person.id) } });
}

export async function runEval(): Promise<EvalReport> {
  const viewers = new Map<EvalWho, Awaited<ReturnType<typeof viewerFor>>>();
  for (const who of Object.keys(EMAILS) as EvalWho[]) viewers.set(who, await viewerFor(who));

  const outcomes: EvalOutcome[] = [];
  let citedAnywhere = 0;
  let answerQuestions = 0;

  for (const question of EVAL_QUESTIONS) {
    const answer = await answerQuestion(viewers.get(question.who)!, question.question, question.locale);
    const titles = answer.citations.map((citation) => citation.pageTitle);
    const first = titles[0] ?? null;
    let pass = false;
    let problem: string | null = null;

    if (question.kind === "answer") {
      answerQuestions++;
      if (question.pages.some((page) => titles.includes(page))) citedAnywhere++;
      const missing = question.expect.filter((fact) => !has(answer.body, fact));
      if (!answer.answered) problem = "no answer";
      else if (!first || !question.pages.includes(first)) problem = `cited "${first}", expected "${question.pages[0]}"`;
      else if (missing.length > 0) problem = `answer misses ${missing.map((fact) => `"${fact}"`).join(", ")}`;
      pass = problem === null;
    } else if (question.kind === "refuse") {
      pass = !answer.answered;
      problem = pass ? null : `answered from "${first}" when it should not have`;
    } else {
      const leaked = titles.filter((title) => question.pages.includes(title));
      pass = leaked.length === 0;
      problem = pass ? null : `LEAKED ${leaked.map((title) => `"${title}"`).join(", ")}`;
    }

    outcomes.push({ id: question.id, who: question.who, locale: question.locale, kind: question.kind, question: question.question, pass, problem, citedPage: first, score: Math.round(answer.score * 1000) / 1000 });
  }

  const tally = (key: (outcome: EvalOutcome) => string) => {
    const result: Record<string, { total: number; passed: number }> = {};
    for (const outcome of outcomes) {
      const bucket = (result[key(outcome)] ??= { total: 0, passed: 0 });
      bucket.total++;
      if (outcome.pass) bucket.passed++;
    }
    return result;
  };

  const driver = chatDriver();
  const passed = outcomes.filter((outcome) => outcome.pass).length;
  return {
    driver: driver.name,
    model: driver.model,
    embeddingModel: (await import("@/modules/kb/service")).embeddingDriver().model,
    total: outcomes.length,
    passed,
    percent: Math.round((passed / outcomes.length) * 1000) / 10,
    byKind: tally((outcome) => outcome.kind),
    byLocale: tally((outcome) => outcome.locale),
    citedAnywhere: answerQuestions === 0 ? 0 : Math.round((citedAnywhere / answerQuestions) * 1000) / 10,
    lowestCorrect: Math.min(...outcomes.filter((outcome) => outcome.kind === "answer" && outcome.pass).map((outcome) => outcome.score), 1),
    highestWronglyAnswered: Math.max(...outcomes.filter((outcome) => outcome.kind === "refuse" && !outcome.pass).map((outcome) => outcome.score), 0),
    failures: outcomes.filter((outcome) => !outcome.pass),
  };
}
