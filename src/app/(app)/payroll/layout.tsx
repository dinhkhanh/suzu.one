// Every payroll screen is compensation tier: rendered per request, never cached (NFR-SEC-08).
// Each page checks its own permission, then asks for a recent re-authentication (FR-PLT-06).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default function PayrollLayout({ children }: LayoutProps<"/payroll">) {
  return children;
}
