"use client";
// The tab rows of the attendance settings and the time clocks: the open tab is the one whose path
// the address starts with, so a layout (rendered once) still shows where the reader is.
import Link from "next/link";
import { usePathname } from "next/navigation";

function Tabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  return (
    <nav className="tab-row">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href || (!tab.exact && pathname.startsWith(`${tab.href}/`)) ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function SettingsTabs({ labels }: { labels: Record<"calendar" | "schedules" | "shifts" | "locations" | "policy" | "devices", string> }) {
  return (
    <Tabs
      tabs={[
        ...(["calendar", "schedules", "shifts", "locations", "policy"] as const).map((tab) => ({ href: `/attendance/settings/${tab}`, label: labels[tab] })),
        { href: "/attendance/devices", label: labels.devices },
      ]}
    />
  );
}

export function DevicesTabs({ labels }: { labels: Record<"devices" | "import" | "profiles", string> }) {
  return (
    <Tabs
      tabs={[
        { href: "/attendance/devices", label: labels.devices },
        { href: "/attendance/devices/import", label: labels.import },
        { href: "/attendance/devices/profiles", label: labels.profiles },
      ]}
    />
  );
}

export function KioskTabs({ labels }: { labels: Record<"kiosks" | "faces", string> }) {
  return (
    <Tabs
      tabs={[
        { href: "/attendance/kiosk", label: labels.kiosks, exact: true },
        { href: "/attendance/kiosk/faces", label: labels.faces },
      ]}
    />
  );
}
