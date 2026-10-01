import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { type AccountHandoffView, canChangeAccountManager, canManageWorkspace, listAccountHandoffs, listClients, loadViewer } from "@/modules/work/service";
import { AccountHandoverForm } from "@/modules/work/ui/exit-handover";
import { HandoffNoteView } from "@/modules/work/ui/handoff";
import { ClientForm } from "@/modules/work/ui/project-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("clients");

export default async function ClientsPage() {
  const user = await requireUser();
  // The client list is company information: not for outside collaborators.
  if (user.principal.workforceType === "collaborator") notFound();
  const viewer = await loadViewer(user);
  const t = await getTranslations("work.clients");
  const tWork = await getTranslations("work");
  const manage = canManageWorkspace(viewer);
  const [clients, entities] = await Promise.all([listClients(), manage ? listEntities() : []]);
  // FR-PJM-46: who owns each relationship, and the notes it changed hands with.
  // Per client: the grant must reach the client's entity (a group client, the whole group).
  const handsOver = (client: { entityId: string | null }) => canChangeAccountManager(viewer, client);
  const handedOver = clients.filter(handsOver);
  const [people, handoffs] = await Promise.all([listPersonNames(), handedOver.length ? listAccountHandoffs(handedOver.map((client) => client.id)) : new Map<string, AccountHandoffView[]>()]);
  const nameOf = (personId: string | null) => (personId ? (people.find((person) => person.id === personId)?.fullName ?? null) : null);
  const [tHandoff, format] = await Promise.all([getTranslations("work.handoff.account"), getFormatter()]);
  const entityOptions = entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const parents = clients.filter((client) => !client.parentId && client.kind === "client").map(({ id, name }) => ({ id, name }));
  const tops = clients.filter((client) => !client.parentId);

  const row = (client: (typeof clients)[number], indent: boolean) => (
    <ListItem key={client.id} className={indent ? "pl-8" : undefined}>
      <details className="min-w-0 flex-1">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{client.code}</span>
          <span className="font-medium">{client.name}</span>
          <Badge variant="outline">{t(`kinds.${client.kind}`)}</Badge>
          {client.isActive ? null : <Badge variant="secondary">{t("inactive")}</Badge>}
          {client.note ? <span className="text-xs text-muted-foreground">{client.note}</span> : null}
          {client.accountManagerPersonId ? <span className="text-xs text-muted-foreground">{tHandoff("current", { name: nameOf(client.accountManagerPersonId) ?? "—" })}</span> : null}
          <Link href={`/crm/accounts/${client.parentId ?? client.id}`} className="ml-auto text-xs underline">
            {t("openAccount")}
          </Link>
        </summary>
        {manage ? (
          <div className="pt-3">
            <ClientForm client={client} parents={parents} entities={entityOptions} />
          </div>
        ) : null}
        {handsOver(client) ? (
          <div className="flex flex-col gap-3 pt-3">
            <AccountHandoverForm clientId={client.id} currentName={nameOf(client.accountManagerPersonId)} people={people.filter((person) => person.id !== client.accountManagerPersonId)} />
            {(handoffs.get(client.id) ?? []).map((handoff) => (
              <div key={handoff.id} className="flex flex-col gap-1 rounded-lg bg-muted/40 p-2">
                <p className="text-xs text-muted-foreground">{tHandoff("history", { from: handoff.fromName ?? "—", to: handoff.toName ?? "—", by: handoff.byName ?? "—", date: format.dateTime(handoff.createdAt, { dateStyle: "medium" }) })}</p>
                <HandoffNoteView note={handoff.note} />
              </div>
            ))}
          </div>
        ) : null}
      </details>
    </ListItem>
  );

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {tWork("title")}
          </Link>
        </p>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <TableCard>
        <List>
          {clients.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
          {tops.flatMap((client) => [row(client, false), ...clients.filter((brand) => brand.parentId === client.id).map((brand) => row(brand, true))])}
        </List>
        {manage ? (
          <TableAddRow label={t("create")} open={clients.length === 0}>
            <ClientForm parents={parents} entities={entityOptions} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}
