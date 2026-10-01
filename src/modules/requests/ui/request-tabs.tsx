// The row of tabs every request screen shares: mine, waiting for me, the settlement desk, and —
// for whoever oversees — everything. Each tab is one of the existing pages; the counts come from
// the same per-person live cache the inbox reads, so the row costs the page nothing extra.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Principal } from "@/modules/platform/rbac/policy";
import { canOverseeRequests } from "@/modules/platform/approvals/policy";
import { loadApprovalsPage } from "@/modules/platform/approvals/service";
import { canSettleExpenseClaims } from "../policy";

export type RequestTab = "mine" | "inbox" | "claims" | "all";

const OPEN = new Set(["pending", "returned"]);

export async function RequestTabs({ active, personId, principal, claimsWaiting }: { active: RequestTab; personId: string; principal: Principal; /** Claims approved and not yet paid — known only to the desk that pays them. */ claimsWaiting?: number }) {
  const [t, { inbox, mine }] = await Promise.all([getTranslations("requests.tabs"), loadApprovalsPage(personId)]);
  const tabs: { key: RequestTab; href: string; label: string; count: number | null }[] = [
    { key: "mine", href: "/requests", label: t("mine"), count: mine.filter((row) => OPEN.has(row.status)).length || null },
    { key: "inbox", href: "/approvals", label: t("inbox"), count: inbox.length || null },
    ...(canSettleExpenseClaims(principal) ? [{ key: "claims" as const, href: "/requests/claims", label: t("claims"), count: claimsWaiting || null }] : []),
    ...(canOverseeRequests(principal) ? [{ key: "all" as const, href: "/approvals/all", label: t("all"), count: null }] : []),
  ];
  return (
    <nav aria-label={t("label")} className="tab-row">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.key === active ? "page" : undefined}>
          {tab.label}
          {tab.count !== null ? <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
