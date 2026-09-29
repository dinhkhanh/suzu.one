// The viewer as the CRM policy wants them: the principal plus their ties to accounts. The ties come
// from four places, three of them already in the shared cache for other screens —
//   the account manager       → the work module's client list (reference tier)
//   the people of its projects → the viewer's project memberships and the work directory
//   the sales owner, named members and deal owners → the CRM's own tables, cached here per person
// so a CRM page costs no query for "who am I to these accounts" once the cache is warm.
import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { type ClientRow, listClients, loadViewerWith, type ViewerSource, type WorkViewer, workDirectory } from "@/modules/work/service";
import type { AccountTie, CrmViewer } from "./policy";

type Executor = Tx | ReturnType<typeof db>;

const tiesKey = (personId: string) => `crm:ties:${personId}`;
type OwnTies = { salesOwner: string[]; member: string[]; dealOwner: string[] };

async function readOwnTies(executor: Executor, personId: string): Promise<OwnTies> {
  const [owned, member, deals] = await Promise.all([
    executor.select({ id: schema.crmAccount.clientId }).from(schema.crmAccount).where(eq(schema.crmAccount.salesOwnerPersonId, personId)).orderBy(schema.crmAccount.clientId),
    executor.select({ id: schema.crmAccountMember.clientId }).from(schema.crmAccountMember).where(eq(schema.crmAccountMember.personId, personId)).orderBy(schema.crmAccountMember.clientId),
    executor.selectDistinct({ id: schema.crmDeal.clientId }).from(schema.crmDeal).where(eq(schema.crmDeal.ownerPersonId, personId)).orderBy(schema.crmDeal.clientId),
  ]);
  return { salesOwner: owned.map((row) => row.id), member: member.map((row) => row.id), dealOwner: deals.map((row) => row.id) };
}

/**
 * After a write to `crm_account.sales_owner_person_id`, `crm_account_member` or `crm_deal.owner_person_id`,
 * with every person it touched (the old owner and the new). Inside the transaction is fine: the
 * stale marker keeps readers off the cache until the commit lands.
 */
export const invalidateTies = (...personIds: readonly (string | null | undefined)[]) => invalidate(...[...new Set(personIds.filter((id): id is string => !!id))].map(tiesKey));

/** A brand belongs to its client's account; a client is its own. */
export function accountIdOf(clients: readonly Pick<ClientRow, "id" | "parentId">[], clientId: string | null | undefined): string | null {
  if (!clientId) return null;
  const client = clients.find((row) => row.id === clientId);
  return client ? (client.parentId ?? client.id) : null;
}

const OPEN_PROJECT = new Set(["planned", "active", "paused"]);

/** The ties, from the pieces — pure, so a test can build a viewer without the cache. */
export function tiesFrom(input: { personId: string; clients: readonly ClientRow[]; own: OwnTies; projectIds: readonly string[]; projects: readonly { id: string; clientId: string | null; status: string }[] }): Map<string, AccountTie[]> {
  const ties = new Map<string, AccountTie[]>();
  const add = (clientId: string | null, tie: AccountTie) => {
    if (!clientId) return;
    const list = ties.get(clientId) ?? [];
    if (!list.includes(tie)) list.push(tie);
    ties.set(clientId, list);
  };
  for (const client of input.clients) {
    // The manager of a brand is on its client's team; managing the account is the client's own manager.
    if (client.accountManagerPersonId === input.personId) add(client.parentId ?? client.id, client.parentId ? "member" : "manager");
  }
  for (const id of input.own.salesOwner) add(id, "sales_owner");
  for (const id of input.own.member) add(id, "member");
  for (const id of input.own.dealOwner) add(accountIdOf(input.clients, id), "deal_owner");
  const mine = new Set(input.projectIds);
  for (const project of input.projects) {
    if (mine.has(project.id) && OPEN_PROJECT.has(project.status)) add(accountIdOf(input.clients, project.clientId), "project");
  }
  return ties;
}

export type CrmContext = { viewer: CrmViewer; work: WorkViewer; clients: ClientRow[] };

async function load(executor: Executor, user: ViewerSource): Promise<CrmContext> {
  const inTx = executor !== db();
  const [work, clients, directory, own] = await Promise.all([
    loadViewerWith(executor, user),
    inTx ? executor.select().from(schema.workClient) : listClients(),
    workDirectory(inTx ? (executor as Tx) : undefined),
    inTx ? readOwnTies(executor, user.person.id) : cached(tiesKey(user.person.id), TTL.personal, () => readOwnTies(executor, user.person.id)),
  ]);
  const ties = tiesFrom({ personId: user.person.id, clients, own, projectIds: [...work.projectRoles.keys()], projects: directory.projects });
  return { viewer: { principal: user.principal, ties }, work, clients };
}

/** Once per request: pages, components and an action's authorize step share one answer. */
export const loadCrm = cache((user: ViewerSource): Promise<CrmContext> => load(db(), user));

/** The same, read inside a transaction (an action re-checking what it is about to change). */
export const loadCrmWith = (executor: Tx, user: ViewerSource): Promise<CrmContext> => load(executor, user);
