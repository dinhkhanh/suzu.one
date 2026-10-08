import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canReadRecruitReports } from "@/modules/recruit/policy";
import { defaultReportFrom, getRecruitReport } from "@/modules/recruit/reports";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("recruitmentReports");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Time to hire, funnel conversion and source effectiveness (FR-REC-11).
 *
 * `report:read` admits somebody to the page; the numbers are counted only over the openings they
 * could open one at a time, so a department head on one hiring team reads that opening's funnel
 * and an empty report otherwise. **There is no money on this page** — cost per hire would need
 * recruitment spend, which nothing in this system records, and a made-up figure is worse than a
 * missing one.
 */
export default async function RecruitReportsPage(props: PageProps<"/recruit/reports">) {
  const user = await requireUser();
  if (!canReadRecruitReports(user.principal)) notFound();

  const query = await props.searchParams;
  const pick = (name: string, pattern: RegExp) => (typeof query[name] === "string" && pattern.test(query[name]) ? query[name] : undefined);
  const today = todayInVietnam();
  const filters = {
    from: (pick("from", DAY) ?? defaultReportFrom(today)) as IsoDate,
    to: (pick("to", DAY) ?? today) as IsoDate,
    openingId: pick("openingId", UUID),
  };

  const [report, t, tStage, tSource, format] = await Promise.all([getRecruitReport(user.principal, filters), getTranslations("recruit.reports"), getTranslations("recruit.stageCategory"), getTranslations("recruit.source"), getFormatter()]);

  const days = (value: number | null) => (value === null ? "—" : t("days", { count: value }));
  const percent = (value: number | null) => (value === null ? "—" : `${value}%`);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/recruit" className="text-sm underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <label className="flex flex-col gap-1.5 text-sm">
          {t("from")}
          <DatePicker name="from" defaultValue={filters.from} className="w-40" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t("to")}
          <DatePicker name="to" defaultValue={filters.to} className="w-40" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t("opening")}
          <Select name="openingId" defaultValue={filters.openingId ?? ""} className="w-64">
            <option value="">{t("allOpenings")}</option>
            {report.openings.map((opening) => (
              <option key={opening.id} value={opening.id}>
                {opening.title} · {opening.code}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("apply")}
        </Button>
      </form>

      <section className="grid gap-3 sm:grid-cols-4">
        {(
          [
            ["applications", report.applications],
            ["openOpenings", report.openOpenings],
            ["hires", report.timeToHire.hires],
            ["active", report.active],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{t(key)}</p>
            <p className="text-2xl font-semibold tabular-nums">{format.number(value)}</p>
          </div>
        ))}
      </section>

      <TableCard>
        <TableCardHeader title={t("funnel")} description={t("funnelHint")} />
        <Table numbered={false}>
          <TableHeader>
            <TableRow>
              <TableHead kind="select">{t("stage")}</TableHead>
              <TableHead kind="number">{t("reached")}</TableHead>
              <TableHead kind="percent">{t("fromPrevious")}</TableHead>
              <TableHead kind="percent">{t("ofApplied")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.steps.map((step) => (
              <TableRow key={step.category}>
                <TableCell>{tStage(step.category)}</TableCell>
                <TableCell kind="number">{step.reached}</TableCell>
                <TableCell kind="percent">{percent(step.conversionFromPrevious)}</TableCell>
                <TableCell kind="percent">{percent(step.shareOfApplied)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("timeToHire")}</h2>
        {report.timeToHire.hires === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHires")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ["median", report.timeToHire.median],
                ["mean", report.timeToHire.mean],
                ["fastest", report.timeToHire.fastest],
                ["slowest", report.timeToHire.slowest],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-xl border p-4">
                <p className="text-xs text-muted-foreground">{t(key)}</p>
                <p className="text-lg font-semibold tabular-nums">{days(value)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <TableCard>
        <TableCardHeader title={t("sources")} />
        <Table numbered={false}>
          <TableHeader>
            <TableRow>
              <TableHead kind="select">{t("source")}</TableHead>
              <TableHead kind="number">{t("applications")}</TableHead>
              <TableHead kind="number">{t("interviewed")}</TableHead>
              <TableHead kind="number">{t("hires")}</TableHead>
              <TableHead kind="percent">{t("hireRate")}</TableHead>
              <TableHead kind="time">{t("medianDays")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.sources.length === 0 ? <TableEmpty>{t("noSources")}</TableEmpty> : null}
            {report.sources.map((row) => (
              <TableRow key={row.source}>
                <TableCell>{tSource(row.source)}</TableCell>
                <TableCell kind="number">{row.applications}</TableCell>
                <TableCell kind="number">{row.interviewed}</TableCell>
                <TableCell kind="number">{row.hires}</TableCell>
                <TableCell kind="percent">{percent(row.hireRate)}</TableCell>
                <TableCell kind="time">{days(row.medianDaysToHire)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <p className="text-xs text-muted-foreground">{t("noCostPerHire")}</p>
    </div>
  );
}
