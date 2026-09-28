import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { listAllRequests, type OversightFilter } from "@/modules/platform/approvals/service";
import { canOverseeRequests } from "@/modules/platform/approvals/policy";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { entityReach } from "@/modules/platform/rbac/policy";
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
  const [t, locale, registered] = await Promise.all([getTranslations("approvals"), getLocale(), allRequestTypes()]);

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
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("oversight.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("oversight.description")}</p>
        </div>
        <Link href="/approvals" className="text-sm underline-offset-4 hover:underline">
          {t("oversight.back")}
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {STATES.map((value) => (
          <Link key={value} href={hrefFor(value)} aria-current={value === state ? "page" : undefined} className={buttonVariants({ size: "sm", variant: value === state ? "default" : "outline" })}>
            {t(`oversight.state.${value}`)}
          </Link>
        ))}
        <form action="/approvals/all" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="state" value={state} />
          <Select name="type" defaultValue={type ?? ""} aria-label={t("oversight.type")} className="w-auto">
            <option value="">{t("oversight.allTypes")}</option>
            {types.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </Select>
          <input type="date" name="since" defaultValue={since ?? ""} aria-label={t("oversight.since")} className="h-9 rounded-[0.625rem] border border-input bg-background px-2.5 text-sm" />
          <button type="submit" className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("oversight.apply")}
          </button>
        </form>
      </div>

      <RequestTable rows={rows} empty={t("oversight.empty")} showRequester labels={labels} showWaitingOn />
      {rows.length === 200 ? <p className="text-xs text-muted-foreground">{t("oversight.limited", { count: 200 })}</p> : null}
    </div>
  );
}
