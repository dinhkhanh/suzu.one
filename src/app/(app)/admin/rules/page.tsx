import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { can } from "@/modules/platform/rbac/policy";
import { PARAMETER_KEYS, type ParameterKey } from "@/modules/platform/statutory/catalogue";
import { versionOn } from "@/modules/platform/statutory/engine/versions";
import { listParameterVersions, type ParameterRow } from "@/modules/platform/statutory/service";
import { DecisionButtons, ProposeParameterForm } from "@/modules/platform/statutory/ui/rule-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("statutoryParameters");

// Rates are stored as basis points and shown as percents; amounts get thousands separators.
function ValueTable({ value, format }: { value: unknown; format: (amount: number, unit: "rate" | "plain") => string }) {
  const rows: [string, unknown][] = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value as Record<string, unknown>);
  const show = (key: string, item: unknown): string => {
    if (item === null) return "∞";
    if (typeof item === "number") return format(item, /rate|bhxh|bhyt|bhtn|fund|dues|resident|withoutContract$/i.test(key) ? "rate" : "plain");
    if (typeof item === "object") return Object.entries(item as Record<string, unknown>).map(([innerKey, inner]) => `${innerKey}: ${show(innerKey, inner)}`).join(" · ");
    return String(item);
  };
  return (
    <dl className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-4 sm:grid-cols-[auto_1fr] gap-y-0.5 text-sm">
      {rows.map(([key, item]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
          <dd className="tabular-nums">{show(key, item)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function RulesPage() {
  const user = await requireUser();
  const canPropose = can(user.principal, "rules:propose", {});
  const canDecide = can(user.principal, "payroll:rules", {});
  if (!canPropose && !canDecide && !can(user.principal, "payroll:read", {})) notFound();

  const [t, formatter, versions] = await Promise.all([getTranslations("rules"), getFormatter(), listParameterVersions()]);
  const today = todayInVietnam();
  const day = (value: string) => formatter.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const format = (amount: number, unit: "rate" | "plain") => (unit === "rate" ? `${formatter.number(amount / 100, { maximumFractionDigits: 2 })}%` : formatter.number(amount));

  const byKey = Map.groupBy(versions, (version) => version.key);
  const current: Partial<Record<ParameterKey, unknown>> = {};
  for (const key of PARAMETER_KEYS) current[key] = versionOn((byKey.get(key) ?? []).filter((version) => version.status === "approved"), today)?.value;
  const proposals = versions.filter((version) => version.status === "proposed");
  const label = (key: string) => (t.has(`parameters.${key.replace(".", "_")}`) ? t(`parameters.${key.replace(".", "_")}`) : key);

  const meta = (version: ParameterRow) => (
    <p className="text-xs text-muted-foreground">
      {day(version.validFrom)} → {version.validTo ? day(version.validTo) : "…"}
      {version.legalReference ? ` · ${version.legalReference}` : ""}
      {version.note ? ` · ${version.note}` : ""}
    </p>
  );

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {proposals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("pending")}</h2>
          {proposals.map((proposal) => (
            <div key={proposal.id} className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
              <p className="text-sm font-medium">{label(proposal.key)}</p>
              {meta(proposal)}
              <ValueTable value={proposal.value} format={format} />
              {canDecide ? <DecisionButtons id={proposal.id} decisions={["approve", "reject"]} /> : null}
            </div>
          ))}
        </section>
      ) : null}

      <ul className="flex flex-col gap-3">
        {PARAMETER_KEYS.map((key) => {
          const all = (byKey.get(key) ?? []).filter((version) => version.status === "approved");
          const inForce = versionOn(all, today);
          const others = all.filter((version) => version.id !== inForce?.id);
          return (
            <li key={key} className="flex flex-col gap-2 rounded-xl border p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {label(key)}
                <span className="font-mono text-xs font-normal text-muted-foreground">{key}</span>
                {inForce && !inForce.isVerified ? <Badge variant="destructive">{t("unverified")}</Badge> : null}
              </p>
              {inForce ? (
                <>
                  {meta(inForce)}
                  <ValueTable value={inForce.value} format={format} />
                  {canDecide && !inForce.isVerified ? <DecisionButtons id={inForce.id} decisions={["verify"]} /> : null}
                </>
              ) : (
                <p className="text-sm text-destructive">{t("missing")}</p>
              )}
              {others.length > 0 ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{t("otherVersions", { count: others.length })}</summary>
                  <div className="mt-2 flex flex-col gap-3">
                    {others.map((version) => (
                      <div key={version.id} className="border-l pl-3">
                        {meta(version)}
                        <ValueTable value={version.value} format={format} />
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canPropose ? <ProposeParameterForm current={current} /> : null}
    </div>
  );
}
