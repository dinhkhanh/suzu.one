import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { listDelegations } from "@/modules/platform/approvals/delegations";
import { DelegationForm, RevokeDelegationButton } from "@/modules/platform/approvals/ui/delegation-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { allRequestTypes } from "../registry";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("delegation");

// "While I am away, my approvals go to …" — everyone manages their own (FR-PLT-22).
export default async function DelegationPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  const [t, format, { given, received }, people, registered] = await Promise.all([getTranslations("approvals"), getFormatter(), listDelegations(user.person.id), listPersonNames(), allRequestTypes()]);
  const label = (type: string) => registered.get(type)?.names?.vi ?? (t.has(`types.${type}`) ? t(`types.${type}` as "types.profile_change") : type);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const types = (row: { requestTypes: string[] | null }) => (row.requestTypes ? row.requestTypes.map(label).join(", ") : t("delegation.allTypes"));
  const current = received.filter((row) => row.validTo >= today);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <Link href="/approvals" className="text-sm text-link hover:underline">
          ← {t("title")}
        </Link>
        <h1>{t("delegation.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("delegation.description")}</p>
      </header>
      <TableCard>
        <TableCardHeader title={t("delegation.given")} count={given.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("delegation.to")}</TableHead>
              <TableHead kind="date">{t("delegation.from")}</TableHead>
              <TableHead kind="date">{t("delegation.until")}</TableHead>
              <TableHead kind="tags">{t("delegation.types")}</TableHead>
              <TableHead kind="text">{t("delegation.reason")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {given.length === 0 ? <TableEmpty>{t("delegation.none")}</TableEmpty> : null}
            {given.map((row) => {
              const state = row.revokedAt ? "revoked" : row.validTo < today ? "ended" : row.validFrom > today ? "upcoming" : "active";
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.toName}</TableCell>
                  <TableCell>{day(row.validFrom)}</TableCell>
                  <TableCell>{day(row.validTo)}</TableCell>
                  <TableCell className="max-w-64 truncate">{types(row)}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">{row.reason ?? "—"}</TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(state)}>{t(`delegation.state.${state}` as "delegation.state.active")}</Badge>
                  </TableCell>
                  <TableCell kind="actions">{state === "active" || state === "upcoming" ? <RevokeDelegationButton id={row.id} /> : null}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TableAddRow label={t("delegation.link")} open={given.length === 0}>
          <div className="[&>form]:rounded-none [&>form]:border-0 [&>form]:p-0">
            <DelegationForm people={people.filter((person) => person.id !== user.person.id)} requestTypes={[...registered.keys()].map((type) => ({ type, name: label(type) }))} today={today} />
          </div>
        </TableAddRow>
      </TableCard>
      <TableCard>
        <TableCardHeader title={t("delegation.received")} count={current.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("delegation.delegator")}</TableHead>
              <TableHead kind="date">{t("delegation.from")}</TableHead>
              <TableHead kind="date">{t("delegation.until")}</TableHead>
              <TableHead kind="tags">{t("delegation.types")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {current.length === 0 ? <TableEmpty>{t("delegation.none")}</TableEmpty> : null}
            {current.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.fromName}</TableCell>
                <TableCell>{day(row.validFrom)}</TableCell>
                <TableCell>{day(row.validTo)}</TableCell>
                <TableCell className="max-w-64 truncate">{types(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
