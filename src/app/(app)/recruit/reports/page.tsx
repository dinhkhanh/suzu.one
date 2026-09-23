import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  const [report, t, tStage, tSource, format] = await Promise.all([
    getRecruitReport(user.principal, filters),
    getTranslations("recruit.reports"),
    getTranslations("recruit.stageCategory"),
    getTranslations("recruit.source"),
    getFormatter(),
  ]);

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
          <Input type="date" name="from" defaultValue={filters.from} className="w-40" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t("to")}
          <Input type="date" name="to" defaultValue={filters.to} className="w-40" />
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("funnel")}</h2>
        <p className="text-xs text-muted-foreground">{t("funnelHint")}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("stage")}</TableHead>
              <TableHead className="text-right">{t("reached")}</TableHead>
              <TableHead className="text-right">{t("fromPrevious")}</TableHead>
              <TableHead className="text-right">{t("ofApplied")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.steps.map((step) => (
              <TableRow key={step.category}>
                <TableCell>{tStage(step.category)}</TableCell>
                <TableCell className="text-right tabular-nums">{step.reached}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(step.conversionFromPrevious)}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(step.shareOfApplied)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("sources")}</h2>
        {report.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSources")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("source")}</TableHead>
                <TableHead className="text-right">{t("applications")}</TableHead>
                <TableHead className="text-right">{t("interviewed")}</TableHead>
                <TableHead className="text-right">{t("hires")}</TableHead>
                <TableHead className="text-right">{t("hireRate")}</TableHead>
                <TableHead className="text-right">{t("medianDays")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.sources.map((row) => (
                <TableRow key={row.source}>
                  <TableCell>{tSource(row.source)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.applications}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.interviewed}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.hires}</TableCell>
                  <TableCell className="text-right tabular-nums">{percent(row.hireRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{days(row.medianDaysToHire)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <p className="text-xs text-muted-foreground">{t("noCostPerHire")}</p>
    </div>
  );
}
