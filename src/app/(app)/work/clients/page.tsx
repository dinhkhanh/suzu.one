import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canManageWorkspace, listClients, loadViewer } from "@/modules/work/service";
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
        </summary>
        {manage ? (
          <div className="pt-3">
            <ClientForm client={client} parents={parents} entities={entityOptions} />
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
