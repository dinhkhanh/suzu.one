"use client";
// The tab row of HR's leave pages: the open tab is the one whose path the address starts with,
// so the layout (rendered once) still shows where the reader is.
import Link from "next/link";
import { usePathname } from "next/navigation";

export function LeaveAdminTabs({ labels, myLeave }: { labels: Record<"balances" | "types" | "staffing" | "import", string>; myLeave: string }) {
  const pathname = usePathname();
  return (
    <nav className="tab-row">
      {(["balances", "types", "staffing", "import"] as const).map((tab) => {
        const href = `/leave/admin/${tab}`;
        return (
          <Link key={tab} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}>
            {labels[tab]}
          </Link>
        );
      })}
      <Link href="/leave" className="ml-auto">
        {myLeave}
      </Link>
    </nav>
  );
}
