import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canConfigureCrm, canPriceForEntity, rateCardView } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { PriceForm, ServiceForm } from "@/modules/crm/ui/config-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmRateCard");

export default async function RateCardPage() {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.rateCard) notFound();
  const today = todayInVietnam();
  const [t, f, locale, services, entities] = await Promise.all([getTranslations("crm"), formatters(), getLocale(), rateCardView(today), listEntities()]);
  const configures = canConfigureCrm(shell.viewer);
  const priceable = entities.filter((entity) => entity.isActive && canPriceForEntity(shell.viewer, entity.id)).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const minutesTotal = (roles: { minutes: number }[]) => roles.reduce((sum, role) => sum + role.minutes, 0);

  return (
    <Page width="default">
      <PageHeader title={t("rateCard.title")} description={t("rateCard.intro")} />
      <CrmTabs current="rateCard" show={shell.show} />
      <TableCard>
        <List numbered>
          {services.length === 0 ? <ListEmpty>{t("rateCard.empty")}</ListEmpty> : null}
          {services.map((service) => (
            <ListItem key={service.id} className="block">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{service.code}</span>
                  <span className="font-medium">{locale === "en" && service.nameEn ? service.nameEn : service.name}</span>
                  <Badge variant="outline">{t(`enums.serviceLine.${service.category as "social"}`)}</Badge>
                  {service.isRecurring ? <Badge variant="info">{t("rateCard.monthly")}</Badge> : null}
                  {service.isActive ? null : <Badge variant="secondary">{t("rateCard.inactive")}</Badge>}
                  <span className="text-xs text-muted-foreground">{t("rateCard.perUnit", { unit: t(`enums.unit.${service.unit as "item"}`), hours: f.hours(minutesTotal(service.roleMinutes)) })}</span>
                  <span className="ml-auto tabular-nums">{f.money(service.priceNow)}</span>
                </summary>
                <div className="flex flex-col gap-3 pt-3">
                  {service.entityPrices.length ? <p className="text-xs text-muted-foreground">{service.entityPrices.map((price) => `${entityName.get(price.entityId) ?? "—"}: ${f.money(price.priceVnd)}`).join(" · ")}</p> : null}
                  {service.upcoming.length ? <p className="text-xs text-muted-foreground">{t("rateCard.upcoming", { prices: service.upcoming.map((price) => `${f.money(price.priceVnd)} ${t("rateCard.from", { date: f.date(price.validFrom) })}${price.entityId ? ` (${entityName.get(price.entityId) ?? "—"})` : ""}`).join(" · ") })}</p> : null}
                  {configures ? <ServiceForm service={service} /> : null}
                  {configures || priceable.length ? <PriceForm serviceId={service.id} entities={priceable} today={today} /> : null}
                </div>
              </details>
            </ListItem>
          ))}
        </List>
        {configures ? (
          <TableAddRow label={t("rateCard.addService")}>
            <ServiceForm />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
