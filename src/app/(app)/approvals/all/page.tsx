import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { listAllRequests, type OversightFilter } from "@/modules/platform/approvals/service";
import { canOverseeRequests } from "@/modules/platform/approvals/policy";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { entityReach } from "@/modules/platform/rbac/policy";
import { RequestTabs } from "@/modules/requests/ui/request-tabs";
import { allRequestTypes } from "../registry";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("approvalsAll");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = ["open", "decided", "all"] as const;

// Every request in the company, whoever it is waiting for (`approval:oversee`, the owner's). The
// inbox is "what is my turn"; this is "what is going on". Each row opens the owning module's page,
// which lets an overseer in (getRequest).
export default async function AllRequestsPage({ searchParams }: PageProps<"/approvals/all">) {
  const user = await requireUser();
  if (!canOverseeRequests(user.principal)) notFound();
  const query = await searchParams;
  const [t, tRequests, locale, registered] = await Promise.all([getTranslations("approvals"), getTranslations("requests"), getLocale(), allRequestTypes()]);

  const state = STATES.find((value) => value === query.state) ?? "open";
  const type = typeof query.type === "string" && registered.has(query.type) ? query.type : undefined;
  const since = typeof query.since === "string" && DATE.test(query.since) ? query.since : undefined;
  const filter: OversightFilter = { state: state === "all" ? undefined : state, type, since };
  const rows = await listAllRequests(entityReach(user.principal, "approval:oversee"), filter);

  const labelOf = (key: string, names?: { vi: string; en: string }) => (names ? (locale === "en" ? names.en : names.vi) : t.has(`types.${key}` as "types.leave") ? t(`types.${key}` as "types.leave") : key);
  const types = [...registered].map(([key, entry]) => ({ key, label: labelOf(key, entry.names) })).sort((a, b) => a.label.localeCompare(b.label, locale));
  const labels = new Map(types.map((entry) => [entry.key, entry.label]));
  const hrefFor = (next: (typeof STATES)[number]) => `/approvals/all?${new URLSearchParams({ state: next, ...(type ? { type } : {}), ...(since ? { since } : {}) })}`;

  return (
    <Page width="wide">
      <PageHeader title={tRequests("hub")} description={t("oversight.description")} />
      <RequestTabs active="all" personId={user.person.id} principal={user.principal} />

      <form action="/approvals/all" className="toolbar">
        <input type="hidden" name="state" value={state} />
        <Segmented aria-label={t("oversight.state.all")} value={state} options={STATES.map((value) => ({ value, label: t(`oversight.state.${value}`), href: hrefFor(value) }))} />
        <Select name="type" defaultValue={type ?? ""} aria-label={t("oversight.type")} className="w-auto">
          <option value="">{t("oversight.allTypes")}</option>
          {types.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </Select>
        <DatePicker name="since" defaultValue={since ?? ""} aria-label={t("oversight.since")} className="w-44" />
        <Button type="submit" variant="outline">
          {t("oversight.apply")}
        </Button>
      </form>

      <Section title={t("oversight.title")} count={rows.length || undefined}>
        <RequestTable rows={rows} empty={t("oversight.empty")} showRequester labels={labels} showWaitingOn />
        {rows.length === 200 ? <p className="text-xs text-faint">{t("oversight.limited", { count: 200 })}</p> : null}
      </Section>
    </Page>
  );
}
