import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canEditContracts, canSeeAccountMoney, canViewContracts, findAccount, findContract, listContracts, listDeals, visibleAccountProjectIds } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { ContractForm, ContractScanLink, LinkProjectForm, SignContractForm, TerminateContractForm, UnlinkProjectButton } from "@/modules/crm/ui/money-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";
import { workDirectory } from "@/modules/work/service";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

export const generateMetadata = pageTitle("crmContract");

export default async function ContractPage({ params }: PageProps<"/crm/contracts/[contractId]">) {
  const user = await requireUser();
  const { contractId } = await params;
  const shell = await crmShell(user);
  const row = /^[0-9a-f-]{36}$/.test(contractId) ? await findContract(contractId) : undefined;
  const account = row ? await findAccount(row.clientId) : null;
  if (!row || !account || !canViewContracts(shell.viewer, account.facts)) notFound();
  const today = todayInVietnam();
  const seesValue = canSeeAccountMoney(shell.viewer, account.facts);
  const edits = canEditContracts(shell.viewer, account.facts);
  const [t, f, [contract], all, entities, deals, projectIds, directory] = await Promise.all([
    getTranslations("crm"),
    formatters(),
    listContracts([account.client.id], () => seesValue, today).then((rows) => rows.filter((item) => item.id === contractId)),
    listContracts([account.client.id], () => false, today),
    listEntities(),
    listDeals(shell.viewer, { clientId: account.client.id, status: "all" }),
    visibleAccountProjectIds(shell.work, account),
    workDirectory(),
  ]);
  const projectName = new Map(directory.projects.map((project) => [project.id, project.name]));
  const linkable = projectIds.filter((id) => !contract.projectIds.includes(id)).map((id) => ({ id, name: projectName.get(id) ?? id }));

  return (
    <Page width="default">
      <PageHeader eyebrow={<><Link href="/crm/contracts" className="underline">
            {t("contracts.title")}
          </Link>{" "}
          ·{" "}
          <Link href={`/crm/accounts/${account.client.id}`} className="underline">
            {account.client.name}
          </Link></>} title={<span className="inline-flex flex-wrap items-center gap-2">{contract.number}
          <Badge dot variant={statusTone(contract.state === "upcoming" ? "scheduled" : contract.state)}>
            {t(`enums.contractState.${contract.state}`)}
          </Badge></span>}>
        <p className="text-sm">{contract.title}</p>
        <p className="text-sm text-muted-foreground">
          {[t(`contract.kinds.${contract.kind as "service"}`), contract.entityName, `${f.date(contract.startDate)} – ${f.date(contract.endDate)}`, contract.paymentTermsDays !== null ? t("contract.termsIs", { days: contract.paymentTermsDays }) : null, "valueVnd" in contract ? f.money(contract.valueVnd) : null].filter(Boolean).join(" · ")}
        </p>
        {contract.signedOn ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {t("contract.signedOnIs", { date: f.date(contract.signedOn) })}
            {contract.signedFileId ? <ContractScanLink contractId={contract.id} fileName={t("contract.scan")} /> : null}
          </p>
        ) : null}
        {contract.renewalDealId ? (
          <p className="text-sm">
            <Link href={`/crm/deals/${contract.renewalDealId}`} className="underline">
              {t("contracts.renewal")}
            </Link>
          </p>
        ) : null}
      </PageHeader>
      <CrmTabs current="contracts" show={shell.show} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("contract.projects")}</h2>
        {contract.projectIds.length === 0 ? <p className="text-sm text-muted-foreground">{t("contract.noProjects")}</p> : null}
        <ul className="flex flex-col gap-1 text-sm">
          {contract.projectIds.map((projectId) => (
            <li key={projectId} className="flex items-center gap-2">
              {projectIds.includes(projectId) ? (
                <Link href={`/projects/${projectId}`} className="underline">
                  {projectName.get(projectId) ?? projectId}
                </Link>
              ) : (
                <span className="text-muted-foreground">{t("contract.hiddenProject")}</span>
              )}
              {edits ? <UnlinkProjectButton clientId={account.client.id} projectId={projectId} /> : null}
            </li>
          ))}
        </ul>
        {edits && linkable.length ? <LinkProjectForm clientId={account.client.id} contractId={contract.id} projects={linkable} /> : null}
      </section>

      {edits && contract.status === "draft" ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("contract.sign")}</h2>
          <SignContractForm contractId={contract.id} today={today} />
        </section>
      ) : null}
      {edits && contract.status !== "terminated" ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("contract.edit")}</summary>
          <div className="pt-3">
            <ContractForm clientId={account.client.id} contract={contract} entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} parents={all.filter((item) => item.kind !== "appendix" && item.id !== contract.id).map((item) => ({ id: item.id, name: `${item.number} · ${item.title}` }))} deals={deals.map((deal) => ({ id: deal.id, name: `${deal.code} · ${deal.title}` }))} seesValue={seesValue} />
          </div>
        </details>
      ) : null}
      {edits && contract.status === "signed" ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium text-destructive">{t("contract.terminate")}</summary>
          <div className="pt-3">
            <TerminateContractForm contractId={contract.id} today={today} />
          </div>
        </details>
      ) : null}
      <RichText text={contract.note} className="text-sm text-muted-foreground" />
    </Page>
  );
}
