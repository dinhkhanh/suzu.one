// What the delivery records say about tasks, in aggregate SQL: revision rounds split into internal
// and client ones (FR-PJM-51, 59, 60), and the facts the deliverables register marks its lines by
// (FR-PJM-05, 53, 55). No authorization inside: the caller names tasks it may already read.
import "server-only";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { rowsOf } from "@/lib/db/rows";
import type { ClientDecisionFacts } from "./schema";

const uuidArray = (ids: readonly string[]) => sql`ARRAY[${sql.join(
  ids.map((id) => sql`${id}::uuid`),
  sql`, `,
)}]::uuid[]`;

export type RevisionRounds = { internal: number; client: number };

/**
 * Rounds per task: every version sent back counts once — as a client round when the decision that
 * sent it back was the client's, else as an internal one. Tasks without any are in the map with zeros.
 */
export async function revisionRoundsByTask(taskIds: readonly string[]): Promise<Map<string, RevisionRounds>> {
  const ids = [...new Set(taskIds)];
  const result = new Map<string, RevisionRounds>(ids.map((id) => [id, { internal: 0, client: 0 }]));
  if (ids.length === 0) return result;
  const rows = rowsOf<{ task_id: string; internal: number; client: number }>(
    await db().execute(sql`
      SELECT d.task_id,
             count(*) FILTER (WHERE NOT coalesce(back.is_client, false))::int AS internal,
             count(*) FILTER (WHERE coalesce(back.is_client, false))::int AS client
        FROM ${schema.workDeliverable} d
        LEFT JOIN LATERAL (
          SELECT x.is_client FROM ${schema.workDeliverableDecision} x
           WHERE x.deliverable_id = d.id AND x.decision = 'changes_required'
           ORDER BY x.created_at DESC LIMIT 1
        ) back ON true
       WHERE d.task_id = ANY(${uuidArray(ids)}) AND d.decision = 'changes_requested'
       GROUP BY d.task_id`),
  );
  for (const row of rows) result.set(row.task_id, { internal: Number(row.internal), client: Number(row.client) });
  return result;
}

export type LastClientDecision = { decision: string; version: number; decidedOn: string; channel: string; decidedByName: string; recordedAt: Date; comment: string | null };
export type DeliveryFacts = { clientApproved: boolean; delivered: boolean; published: boolean; lastClientDecision: LastClientDecision | null };

/**
 * Per task: whether the client approved a version (a frozen version), whether a delivery was
 * recorded, whether a post is out (published with its URL), and the latest client decision. One
 * query; every task asked about is in the map.
 */
export async function deliveryFactsByTask(taskIds: readonly string[]): Promise<Map<string, DeliveryFacts>> {
  const ids = [...new Set(taskIds)];
  const result = new Map<string, DeliveryFacts>(ids.map((id) => [id, { clientApproved: false, delivered: false, published: false, lastClientDecision: null }]));
  if (ids.length === 0) return result;
  const rows = rowsOf<{ task_id: string; client_approved: boolean; delivered: boolean; published: boolean; decision: string | null; version: number | null; client: ClientDecisionFacts | null; recorded_at: Date | string | null; comment: string | null }>(
    await db().execute(sql`
      SELECT t.id AS task_id,
             EXISTS (SELECT 1 FROM ${schema.workDeliverable} d WHERE d.task_id = t.id AND d.frozen_at IS NOT NULL) AS client_approved,
             EXISTS (SELECT 1 FROM ${schema.workDelivery} v WHERE v.task_id = t.id) AS delivered,
             EXISTS (SELECT 1 FROM ${schema.workPublish} p WHERE p.task_id = t.id AND p.status = 'published' AND p.url IS NOT NULL) AS published,
             last.decision, last.version, last.client, last.created_at AS recorded_at, last.comment
        FROM unnest(${uuidArray(ids)}) AS t(id)
        LEFT JOIN LATERAL (
          SELECT x.decision, d.version, x.client, x.created_at, x.comment
            FROM ${schema.workDeliverableDecision} x
            JOIN ${schema.workDeliverable} d ON d.id = x.deliverable_id
           WHERE d.task_id = t.id AND x.is_client
           ORDER BY x.created_at DESC LIMIT 1
        ) last ON true`),
  );
  for (const row of rows) {
    result.set(row.task_id, {
      clientApproved: !!row.client_approved,
      delivered: !!row.delivered,
      published: !!row.published,
      lastClientDecision:
        row.decision && row.client
          ? { decision: row.decision, version: Number(row.version), decidedOn: row.client.decidedOn, channel: row.client.channel, decidedByName: row.client.decidedByName, recordedAt: new Date(row.recorded_at!), comment: row.comment }
          : null,
    });
  }
  return result;
}
