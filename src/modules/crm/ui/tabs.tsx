// The CRM's own tab row, shown on every CRM page: links, not state — every tab is its own page and
// checks access itself; a tab the reader cannot use is not offered. The underlined `.tab-row` of
// the design, which scrolls sideways on a phone.
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const CRM_TABS = ["home", "deals", "accounts", "leads", "contracts", "invoices", "reports", "commission", "rateCard", "settings"] as const;
export type CrmTab = (typeof CRM_TABS)[number];

const HREF: Record<CrmTab, string> = {
  home: "/crm",
  accounts: "/crm/accounts",
  leads: "/crm/leads",
  deals: "/crm/deals",
  contracts: "/crm/contracts",
  invoices: "/crm/invoices",
  reports: "/crm/reports",
  commission: "/crm/commission",
  rateCard: "/crm/rate-card",
  settings: "/crm/settings",
};

export async function CrmTabs({ current, show }: { current: CrmTab; show: Partial<Record<CrmTab, boolean>> }) {
  const t = await getTranslations("crm.tabs");
  const tabs = CRM_TABS.filter((tab) => show[tab] !== false);
  return (
    <nav aria-label={t("label")} className="tab-row">
      {tabs.map((tab) => (
        <Link key={tab} href={HREF[tab]} aria-current={tab === current ? "page" : undefined}>
          {t(tab)}
        </Link>
      ))}
    </nav>
  );
}
