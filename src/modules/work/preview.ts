import "server-only";
// The client's expiring, no-login review link (D24, FR-PJM-51a) — the **second public surface** of
// the product, beside the careers page (A8), and the only one that writes into work management.
//
// The shape of it: the account manager opens a task's version, makes a link, copies it once and
// sends it however they already talk to the client. The client opens a page that shows one version
// of one piece of work and nothing else of the company, and — when the link allows it — says
// approve, approve with changes, or request changes, with their name and a comment.
//
// What that decision *is* matters more than the page: it goes through `recordClientDecision`, the
// same use-case the account manager's own recording uses (FR-PJM-51). So the review chain, the
// client revision rounds, the frozen version, the activity entry and the `tasks.client_decision`
// notice all behave identically whichever way the client answered. There is no second decision path
// to keep in step, and that is the whole design.
//
// Everything on this file's public half is written for a hostile caller, exactly like
// `recruit/public.ts`:
//
//   · **Nothing but the token is in the URL**, the token is never stored (only SHA-256 of it), and
//     it is compared in constant time.
//   · **Every way a link can be unusable answers identically** — unknown, expired, revoked, already
//     decided: one page, one sentence, never why. A page that distinguished them would be a machine
//     for probing tokens.
//   · **No internal identifier crosses the boundary.** `PreviewPage` below has no uuid in it at
//     all, so a page cannot print one by accident, and a private project keeps its name.
//   · **No address is kept, and what stands in for one stops meaning anything by the next day.** A
//     view is a count and a timestamp; the rate limiter and the audit row key on the hashed
//     visitor the public pipeline computes, re-keyed daily by `previewVisitorKey` so nothing kept
//     here can be joined across days to anything else (PDPL, NFR-PRV-02). The page says so.
//   · **The client only ever sees a version the company has finished with.** The link is made for
//     one version (FR-PJM-51a) and pinned to it there and then, and `clientMayReview` is asked
//     again on every open: work sent back internally, or still waiting at an internal stage of a
//     review chain, is not something a client may look at or approve.
//   · **The mutation is a `createPublicAction`**, so parse → rate limit → spam check → run → audit
//     cannot be skipped, and no refusal reaches the caller as anything but a message key.
import { and, desc, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { todayInVietnam } from "@/lib/dates";
import { createPublicAction, type RateLimitOutcome, type Visitor } from "@/lib/public-action";
import { createDownloadLink, findFile } from "@/modules/platform/files/service";
import {
  clientMayReview,
  hashPreviewToken,
  isPreviewTokenShaped,
  linkIsOpen,
  linkState,
  newPreviewToken,
  PREVIEW_COMMENT_MAX,
  PREVIEW_DECISIONS,
  PREVIEW_LIMITS,
  PREVIEW_NAME_MAX,
  type PreviewBucket,
  previewCommentRequired,
  previewExpiresAt,
  previewTokenMatches,
  previewVisitorKey,
  type PreviewState,
  retryAfterSeconds,
  windowStartFor,
  withinLimit,
} from "./engine/preview";
import { notify } from "../platform/notifications/service";
import { clientOfTask, currentStage, findDeliverable, recordClientDecision } from "./reviews";
import { type LoadedTask, loadTask, taskKey } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;
export type PreviewLinkRow = typeof schema.workPreviewLink.$inferSelect;

const now = () => new Date();

/** What a decision made on a link is recorded as, beside "email", "zalo", "meeting" (FR-PJM-51). */
export const PREVIEW_CHANNEL = "preview_link";

// ── Rate limiting (NFR-SEC-03) ──────────────────────────────────────────────────────────────

/**
 * Counts one request and says whether it is allowed — the careers page's mechanism, in this
 * module's own table: one row per (bucket, key, window), one atomic upsert that cannot race, and
 * the returned count already includes this call.
 *
 * `keyHash` is a hashed visitor or a token's hash. Nothing readable is ever passed in, so a dump of
 * `work_preview_hit` says only that *somebody* asked something, which is all a limiter needs.
 */
export async function countPreviewHit(bucket: PreviewBucket, keyHash: string, at: Date = now()): Promise<RateLimitOutcome> {
  const limit = PREVIEW_LIMITS[bucket];
  const windowStart = windowStartFor(at, limit.windowSeconds);
  const [row] = await db()
    .insert(schema.workPreviewHit)
    .values({ bucket, keyHash, windowStart, hits: 1, lastAt: at })
    .onConflictDoUpdate({
      target: [schema.workPreviewHit.bucket, schema.workPreviewHit.keyHash, schema.workPreviewHit.windowStart],
      set: { hits: sql`${schema.workPreviewHit.hits} + 1`, lastAt: at },
    })
    .returning({ hits: schema.workPreviewHit.hits });
  return withinLimit(row?.hits ?? 1, limit) ? { ok: true } : { ok: false, retryAfterSeconds: retryAfterSeconds(at, limit.windowSeconds) };
}

/** Counted windows nobody can still be inside. Swept nightly; see `workPreviewSweepJob`. */
export async function purgePreviewHits(before: Date): Promise<number> {
  // How many went is a number the job logs, and the database already counts them: reading the rows
  // back to count them in JS would be carrying a week of somebody's counted requests into memory.
  const result = await db().delete(schema.workPreviewHit).where(lt(schema.workPreviewHit.windowStart, before));
  return rowsAffected(result);
}

/**
 * How many rows a write touched, whichever driver ran it: postgres-js answers with `count`, the
 * PGlite the service tests run on with `rowCount`. Nothing else in the module needs this, so it
 * stays here rather than growing into `@/lib/db`.
 */
const rowsAffected = (result: unknown): number => {
  const value = result as { count?: number; rowCount?: number } | undefined;
  return value?.count ?? value?.rowCount ?? 0;
};

/**
 * The key this surface counts and audits a visitor under: the public pipeline's hashed address,
 * re-keyed for the day (PDPL, NFR-PRV-02). The user agent is dropped with it — an audit row kept
 * for years has no business holding a description of a client's phone. What remains is enough to
 * stop one connection hammering the page for an hour, and nothing else.
 */
const previewVisitor = (visitor: Visitor, at: Date): Visitor => ({ ipHash: previewVisitorKey(visitor.ipHash, at), userAgent: null });

// ── Finding a link ──────────────────────────────────────────────────────────────────────────

/**
 * The link a token opens, by its hash. Unique-indexed, so the lookup is one index hit, and then
 * compared in constant time: the index gives the speed, the comparison means a timing difference
 * cannot be read off a near-miss. A token of the wrong shape never reaches the database at all.
 */
async function linkForToken(token: string, executor: Executor = db()): Promise<PreviewLinkRow | undefined> {
  const hash = hashPreviewToken(token);
  const [row] = await executor.select().from(schema.workPreviewLink).where(eq(schema.workPreviewLink.tokenHash, hash)).limit(1);
  return row && previewTokenMatches(row.tokenHash, token) ? row : undefined;
}

/** One link and the task it belongs to, for an action's authorize step. */
export async function findPreviewLink(linkId: string): Promise<{ link: PreviewLinkRow; loaded: LoadedTask } | undefined> {
  const [link] = await db().select().from(schema.workPreviewLink).where(eq(schema.workPreviewLink.id, linkId)).limit(1);
  if (!link) return undefined;
  const loaded = await loadTask(link.taskId);
  return loaded ? { link, loaded } : undefined;
}

// ── Making one ──────────────────────────────────────────────────────────────────────────────

export type NewPreviewLink = {
  taskId: string;
  /** null = the newest version at the moment the link is made, which is then what it is made for. */
  deliverableId: string | null;
  label: string | null;
  message: string | null;
  allowDecision: boolean;
  days: number;
};

/**
 * Mints a link and returns the **one and only** copy of its token. The caller shows it to the
 * account manager once; nothing stores it, and asking for it again means making a new link.
 *
 * The version is **resolved here and written onto the link**, whether it was named or left to "the
 * newest one": a link is to one deliverable version (FR-PJM-51a), so what the client opens is what
 * the person who sent it was looking at, and a draft handed in three days later never becomes what
 * the client sees — let alone what they approve.
 */
export async function createPreviewLink(input: NewPreviewLink, actorPersonId: string): Promise<{ link: PreviewLinkRow; token: string; path: string }> {
  const token = newPreviewToken();
  const link = await db().transaction(async (tx) => {
    const loaded = await loadTask(input.taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const deliverable = input.deliverableId ? await findDeliverable(input.deliverableId, tx) : await currentVersion(tx, input.taskId);
    // A version of another task is not a version of this one, whoever asks; and a task with nothing
    // handed in has nothing to put on the page.
    if (!deliverable || (input.deliverableId && deliverable.taskId !== input.taskId)) throw new ActionError(input.deliverableId ? "deliverable_not_found" : "preview_no_version");
    // Work the company has sent back, or is still reviewing at an internal stage of a chain, is not
    // something to put in front of a client — however the version was chosen.
    if (!clientMayReview(deliverable, (await currentStage(deliverable, tx))?.stage ?? null)) throw new ActionError("preview_version_not_ready");
    const [row] = await tx
      .insert(schema.workPreviewLink)
      .values({
        taskId: input.taskId,
        deliverableId: deliverable.id,
        tokenHash: hashPreviewToken(token),
        label: input.label,
        message: input.message,
        allowDecision: input.allowDecision,
        expiresAt: previewExpiresAt(now(), input.days),
        createdByPersonId: actorPersonId,
      })
      .returning();
    return row;
  });
  return { link, token, path: `/preview/${token}` };
}

/** Cutting a link off. Idempotent: a link already revoked stays revoked, by whoever did it first. */
export async function revokePreviewLink(linkId: string, actorPersonId: string): Promise<PreviewLinkRow> {
  const [row] = await db()
    .update(schema.workPreviewLink)
    .set({ revokedAt: now(), revokedByPersonId: actorPersonId })
    .where(and(eq(schema.workPreviewLink.id, linkId), isNull(schema.workPreviewLink.revokedAt)))
    .returning();
  if (row) return row;
  const found = await findPreviewLink(linkId);
  if (!found) throw new ActionError("preview_link_not_found");
  return found.link;
}

// ── What the people inside the company see ──────────────────────────────────────────────────

export type PreviewLinkView = {
  id: string;
  label: string | null;
  message: string | null;
  allowDecision: boolean;
  /** The version it is pinned to; null = whichever is current. */
  version: number | null;
  state: PreviewState;
  expiresAt: Date;
  viewCount: number;
  lastViewedAt: Date | null;
  createdByName: string | null;
  createdAt: Date;
  /** What the client said on it, once they have. */
  decision: { decision: string; decidedByName: string; comment: string | null; at: Date } | null;
};

/** Every link ever made on a task, newest first. The caller has already been checked. */
export async function listPreviewLinks(taskId: string): Promise<PreviewLinkView[]> {
  const at = now();
  const rows = await db()
    .select({ link: schema.workPreviewLink, version: schema.workDeliverable.version, createdByName: schema.person.fullName, decision: schema.workDeliverableDecision })
    .from(schema.workPreviewLink)
    .leftJoin(schema.workDeliverable, eq(schema.workDeliverable.id, schema.workPreviewLink.deliverableId))
    .leftJoin(schema.person, eq(schema.person.id, schema.workPreviewLink.createdByPersonId))
    .leftJoin(schema.workDeliverableDecision, eq(schema.workDeliverableDecision.id, schema.workPreviewLink.decisionId))
    .where(eq(schema.workPreviewLink.taskId, taskId))
    .orderBy(desc(schema.workPreviewLink.createdAt));
  return rows.map(({ link, version, createdByName, decision }) => ({
    id: link.id,
    label: link.label,
    message: link.message,
    allowDecision: link.allowDecision,
    version,
    state: linkState(link, at),
    expiresAt: link.expiresAt,
    viewCount: link.viewCount,
    lastViewedAt: link.lastViewedAt,
    createdByName,
    createdAt: link.createdAt,
    decision: decision ? { decision: decision.decision, decidedByName: decision.client?.decidedByName ?? "", comment: decision.comment, at: decision.createdAt } : null,
  }));
}

// ── What the client sees ────────────────────────────────────────────────────────────────────

/**
 * The page, as a stranger holding the link sees it. **No identifiers** — not the task, not the
 * project, not the client, not the link itself — and nothing of the company beyond the sender's
 * display name: no other task, no internal comment, no fee, no colleague.
 *
 * A **private** project (FR-WRK-18) keeps even its name: the client is told what they are looking
 * at by the brand they already belong to, and a private project's name is exactly the kind of thing
 * that stays inside.
 */
export type PreviewPage = {
  clientName: string | null;
  projectName: string | null;
  title: string;
  version: number;
  kind: "file" | "link";
  /** The external link, or a signed storage URL that lives a minute — see `signedFileUrl`. */
  url: string | null;
  fileName: string | null;
  message: string | null;
  senderName: string;
  recipientLabel: string | null;
  allowDecision: boolean;
  expiresAt: Date;
};

/** The newest version still worth showing, as `createPreviewLink` picks one to pin the link to. */
async function currentVersion(executor: Executor, taskId: string) {
  const [row] = await executor
    .select()
    .from(schema.workDeliverable)
    .where(and(eq(schema.workDeliverable.taskId, taskId), sql`${schema.workDeliverable.decision} <> 'superseded'`))
    .orderBy(desc(schema.workDeliverable.version))
    .limit(1);
  return row;
}

/**
 * The one version a link is for, if the client may still see it. Asked again on every open and
 * again before the decision is claimed, because what was finished with internally on the day the
 * link was made can have been sent back since — and a version the company has taken back is not a
 * version a client may approve.
 *
 * `deliverableId` is written by `createPreviewLink`, so the fallback is only for links minted
 * before it was: they keep resolving to the newest version, under the same gate.
 */
async function deliverableOf(executor: Executor, link: PreviewLinkRow) {
  const deliverable = link.deliverableId ? await findDeliverable(link.deliverableId, executor) : await currentVersion(executor, link.taskId);
  if (!deliverable) return undefined;
  return clientMayReview(deliverable, (await currentStage(deliverable, executor))?.stage ?? null) ? deliverable : undefined;
}

/**
 * A file the client may open, as a signed URL that lives one minute.
 *
 * Two things it is honest to say about that URL, since it leaves the company: it is storage's own,
 * so it **names the object** — the bucket and the file's uuid are in it, though nothing about the
 * task, the project or the client is — and, like every signed URL, it is good for its minute
 * wherever it is taken. Revoking the link a minute after the client opened the page does not reach
 * a URL storage has already signed; it stops the next one being made, which is the whole of what
 * revocation can mean without proxying every byte of a video through the application.
 *
 * A storage outage must not turn the page into a 500 — the client still sees the work's name, the
 * message and the buttons — so the failure is logged and the link is simply absent.
 */
async function signedFileUrl(fileId: string, asPersonId: string): Promise<{ url: string | null; fileName: string | null }> {
  const file = await findFile(fileId);
  if (!file) return { url: null, fileName: null };
  try {
    return { url: await createDownloadLink(file, { personId: asPersonId }), fileName: file.fileName };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "work.preview.file_url_failed", message: error instanceof Error ? error.message : String(error) }));
    return { url: null, fileName: file.fileName };
  }
}

export type PreviewOutcome = { ok: true; page: PreviewPage } | { ok: false; reason: "closed" | "rate_limited" };

/**
 * Opening a link. Counted twice — once against the visitor, so a script cannot walk the token
 * space, and once against the link itself, so a leaked one cannot be hammered from everywhere. The
 * visitor's count comes first and costs one row whatever the token is; the link's is counted only
 * once a token has resolved, so a scanner cannot fill the table with rows of its own invention.
 *
 * Nothing at all is written for a request whose token is not even the right **shape**: that is
 * decided in the process, and a stranger typing rubbish into the address bar is not a reason to
 * write a row about them.
 *
 * A view is recorded on the link — a count and a time, never who — and that is what tells the
 * account manager the client has seen it.
 */
export async function openPreviewLink(token: string, visitor: Visitor): Promise<PreviewOutcome> {
  if (!isPreviewTokenShaped(token)) return { ok: false, reason: "closed" };
  const key = previewVisitor(visitor, now()).ipHash;
  const visitorLimit = await countPreviewHit("view", key);
  if (!visitorLimit.ok) return { ok: false, reason: "rate_limited" };

  const link = await linkForToken(token);
  // Unknown, expired, revoked, already decided — one answer, and it is the same one a token nobody
  // ever issued gets.
  if (!link) return { ok: false, reason: "closed" };
  const tokenLimit = await countPreviewHit("token_view", link.tokenHash);
  if (!tokenLimit.ok) return { ok: false, reason: "rate_limited" };
  if (!linkIsOpen(link, now())) return { ok: false, reason: "closed" };

  const loaded = await loadTask(link.taskId);
  const deliverable = await deliverableOf(db(), link);
  // The task was deleted, every version was withdrawn, or the version this link is for has gone
  // back inside the company: there is nothing to show, and the client is told the same thing as
  // for any other closed link.
  if (!loaded || !deliverable) return { ok: false, reason: "closed" };

  const [client, sender] = await Promise.all([
    clientOfTask(loaded),
    db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, link.createdByPersonId)).limit(1),
  ]);
  const file = deliverable.kind === "file" && deliverable.fileId ? await signedFileUrl(deliverable.fileId, link.createdByPersonId) : null;

  await db()
    .update(schema.workPreviewLink)
    .set({ viewCount: sql`${schema.workPreviewLink.viewCount} + 1`, lastViewedAt: now() })
    .where(eq(schema.workPreviewLink.id, link.id));

  return {
    ok: true,
    page: {
      clientName: client.name,
      projectName: loaded.project && loaded.project.visibility !== "private" ? loaded.project.name : null,
      title: loaded.task.title,
      version: deliverable.version,
      kind: deliverable.kind === "file" ? "file" : "link",
      url: file ? file.url : deliverable.url,
      fileName: file?.fileName ?? null,
      message: link.message,
      senderName: sender[0]?.fullName ?? "",
      recipientLabel: link.label,
      allowDecision: link.allowDecision && !!deliverable && !deliverable.frozenAt,
      expiresAt: link.expiresAt,
    },
  };
}

// ── The client's decision ───────────────────────────────────────────────────────────────────

const decisionSchema = z.object({
  token: z.string().trim().min(16).max(200),
  /** The honeypot, exactly as on the careers form: no person can see it, so anything in it is a machine. */
  website: z.string().max(200).default(""),
  /**
   * Which version the client was looking at when they pressed the button — the page puts it in the
   * form. A decision is about a particular piece of work, so it is claimed against the version the
   * client read and refused if that is no longer the one the link is for.
   */
  version: z.coerce.number().int().min(1).max(100_000),
  decision: z.enum(PREVIEW_DECISIONS),
  decidedByName: z.string().trim().min(1).max(PREVIEW_NAME_MAX),
  comment: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(PREVIEW_COMMENT_MAX).nullable().default(null)),
});

/** What the route handler has: form values, all of them strings, none of them trusted. */
export type PreviewDecisionInput = { token: string; website: string; version: string; decision: string; decidedByName: string; comment: string };
/** What the client is told. The same word whatever happened, for the same reason the careers form gives one. */
export type PreviewDecisionOutcome = { recorded: true };

/**
 * Claims the one decision a link may take, before anything is written. Two tabs, two answers, one
 * winner: the `decided_at is null` guard is what makes it a claim and not a check. If recording
 * then fails the claim is released, so an honest refusal — a frozen version, a comment the client
 * forgot — does not burn the link.
 *
 * The whole of what makes a link usable is re-asked **in the claim**, expiry included: a request
 * that spent a minute reading rows must not be able to write a decision onto a link that ran out
 * while it was reading.
 *
 * Exported, with its release below, because the orderings they are written for cannot be produced
 * through the public entry point: the test puts them in the order a race would.
 */
export async function claimLink(linkId: string, at: Date): Promise<boolean> {
  const rows = await db()
    .update(schema.workPreviewLink)
    .set({ decidedAt: at })
    .where(and(eq(schema.workPreviewLink.id, linkId), isNull(schema.workPreviewLink.decidedAt), isNull(schema.workPreviewLink.revokedAt), gt(schema.workPreviewLink.expiresAt, at)))
    .returning({ id: schema.workPreviewLink.id });
  return rows.length === 1;
}

/**
 * Giving the claim back after a refusal — **only the claim this request made**. A late release
 * that cleared `decided_at` whatever it held could wipe another request's live claim and let a
 * second decision be recorded on the same link, which is the one thing the claim exists to stop.
 */
export const releaseClaim = (linkId: string, at: Date) => db().update(schema.workPreviewLink).set({ decidedAt: null }).where(and(eq(schema.workPreviewLink.id, linkId), eq(schema.workPreviewLink.decidedAt, at)));

const decidePipeline = createPublicAction({
  name: "work.preview.decide",
  input: decisionSchema,
  rateLimit: ({ visitor }) => countPreviewHit("decide", visitor.ipHash),
  spamCheck: (input) => (input.website.trim() === "" ? { verdict: "ok" } : { verdict: "drop", reason: "honeypot" }),
  dropped: (): PreviewDecisionOutcome => ({ recorded: true }),
  run: async ({ input }) => {
    const link = await linkForToken(input.token);
    if (!link) throw new ActionError("preview_link_closed");
    const tokenLimit = await countPreviewHit("token_decide", link.tokenHash);
    if (!tokenLimit.ok) throw new ActionError("rate_limited");
    const at = now();
    // A view-only link is a closed link to anybody trying to post to it: it never offered a button.
    if (!linkIsOpen(link, at) || !link.allowDecision) throw new ActionError("preview_link_closed");
    if (previewCommentRequired(input.decision) && !input.comment) throw new ActionError("preview_comment_required");

    const loaded = await loadTask(link.taskId);
    const deliverable = loaded ? await deliverableOf(db(), link) : undefined;
    if (!loaded || !deliverable) throw new ActionError("preview_link_closed");
    // The answer is about the version the client read, and only that one. A tab left open while the
    // work moved on is told plainly rather than having its answer recorded against something else.
    if (deliverable.version !== input.version) throw new ActionError("preview_version_changed");
    const [sender] = await db().select({ fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, link.createdByPersonId)).limit(1);

    if (!(await claimLink(link.id, at))) throw new ActionError("preview_link_closed");
    try {
      // The same use-case the account manager's own recording goes through (FR-PJM-51): the review
      // chain, the client rounds, the frozen version and the `tasks.client_decision` notice all
      // follow from it. The account manager who made the link is the actor — they are the person
      // inside the company who carried the client's word in, as they would have done by hand.
      await recordClientDecision(
        deliverable.id,
        {
          decision: input.decision,
          comment: input.comment,
          client: {
            channel: PREVIEW_CHANNEL,
            decidedByName: input.decidedByName,
            decidedOn: todayInVietnam(),
            evidenceFileId: null,
            // The evidence *is* the link: the row that recorded the view, the expiry and who made
            // it. It carries no token, so the record can be read inside the company by people who
            // must never be able to open the client's page.
            evidenceUrl: `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/work/tasks/${link.taskId}?preview=${link.id}`,
          },
        },
        { personId: link.createdByPersonId, fullName: sender?.fullName ?? "" },
      );
    } catch (error) {
      await releaseClaim(link.id, at);
      throw error;
    }

    // The person who sent the link hears that the client answered — in its own words, because a
    // decision made by the client on the link reads differently from one the account manager
    // recorded afterwards. `recordClientDecision` tells the assignee and the project's lead but
    // leaves the actor out, and here the actor did not press the button: the client did.
    await notify({
      recipients: [link.createdByPersonId],
      kind: "tasks.preview_decided",
      params: { name: input.decidedByName, task: `${taskKey(loaded.team.key, loaded.work.number)} ${loaded.task.title}` },
      link: `/work/tasks/${link.taskId}`,
    });

    // Which row it produced, so the link's own list can show what the client said. The newest
    // client decision on that version is this one: the link was claimed before it was written.
    const [decision] = await db()
      .select({ id: schema.workDeliverableDecision.id })
      .from(schema.workDeliverableDecision)
      .where(and(eq(schema.workDeliverableDecision.deliverableId, deliverable.id), eq(schema.workDeliverableDecision.isClient, true), gte(schema.workDeliverableDecision.createdAt, at)))
      .orderBy(desc(schema.workDeliverableDecision.createdAt))
      .limit(1);
    if (decision) await db().update(schema.workPreviewLink).set({ decisionId: decision.id }).where(eq(schema.workPreviewLink.id, link.id));

    return {
      data: { recorded: true } as PreviewDecisionOutcome,
      audit: {
        resource: { type: "task:work", id: link.taskId, entityId: loaded.task.entityId },
        // The client's name is on the decision record, where the people running the work read it.
        // The audit log is read across the company, so it carries the version and the verdict only.
        summary: `${loaded.task.title}: v${deliverable.version} client ${input.decision} through a review link`,
        after: { version: deliverable.version, decision: input.decision, channel: PREVIEW_CHANNEL, allowDecision: link.allowDecision },
      },
    };
  },
});

/**
 * The third public mutation in the product, and the first that is not about hiring. The visitor is
 * re-keyed for the day on the way in, so the rate limiter and the audit row this writes hold a
 * fingerprint that stops meaning anything tomorrow (PDPL, NFR-PRV-02).
 */
export async function decideOnPreviewLink(input: PreviewDecisionInput, visitor: Visitor) {
  return decidePipeline(input, previewVisitor(visitor, now()));
}
