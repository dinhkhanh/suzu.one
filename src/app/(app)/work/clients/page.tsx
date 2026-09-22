import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { type AccountHandoffView, canChangeAccountManager, canManageWorkspace, listAccountHandoffs, listClients, loadViewer } from "@/modules/work/service";
import { AccountHandoverForm } from "@/modules/work/ui/exit-handover";
import { HandoffNoteView } from "@/modules/work/ui/handoff";
import { ClientForm } from "@/modules/work/ui/project-forms";

export const metadata: Metadata = { title: "Clients" };

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
  const handsOver = canChangeAccountManager(viewer);
  const [people, handoffs] = await Promise.all([listPersonNames(), handsOver ? listAccountHandoffs(clients.map((client) => client.id)) : new Map<string, AccountHandoffView[]>()]);
  const nameOf = (personId: string | null) => (personId ? (people.find((person) => person.id === personId)?.fullName ?? null) : null);
  const [tHandoff, format] = await Promise.all([getTranslations("work.handoff.account"), getFormatter()]);
  const entityOptions = entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const parents = clients.filter((client) => !client.parentId && client.kind === "client").map(({ id, name }) => ({ id, name }));
  const tops = clients.filter((client) => !client.parentId);

  const row = (client: (typeof clients)[number], indent: boolean) => (
    <li key={client.id} className={`p-3 text-sm ${indent ? "pl-8" : ""}`}>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{client.code}</span>
          <span className="font-medium">{client.name}</span>
          <Badge variant="outline">{t(`kinds.${client.kind}`)}</Badge>
          {client.isActive ? null : <Badge variant="secondary">{t("inactive")}</Badge>}
          {client.note ? <span className="text-xs text-muted-foreground">{client.note}</span> : null}
          {client.accountManagerPersonId ? <span className="text-xs text-muted-foreground">{tHandoff("current", { name: nameOf(client.accountManagerPersonId) ?? "—" })}</span> : null}
        </summary>
        {manage ? (
          <div className="pt-3">
            <ClientForm client={client} parents={parents} entities={entityOptions} />
          </div>
        ) : null}
        {handsOver ? (
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
    </li>
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
      <ul className="flex flex-col divide-y rounded-xl border">
        {clients.length === 0 ? <li className="p-3 text-sm text-muted-foreground">{t("empty")}</li> : null}
        {tops.flatMap((client) => [row(client, false), ...clients.filter((brand) => brand.parentId === client.id).map((brand) => row(brand, true))])}
      </ul>
      {manage ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("create")}</h2>
          <ClientForm parents={parents} entities={entityOptions} />
        </section>
      ) : null}
    </div>
  );
}
