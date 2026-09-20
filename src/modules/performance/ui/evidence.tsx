// The evidence panel drawn beside a review form (FR-PRF-07). Display only: the page has already
// decided the viewer may read this person's performance data, and every figure here is personal
// tier. Nothing in this panel is money.
import type { ReviewEvidence } from "../evidence";

type Translate = (key: string, values?: Record<string, string | number>) => string;
type NumberFormat = { number(value: number, options?: { maximumFractionDigits?: number }): string };
type Labels = { t: Translate; format: NumberFormat };

const percent = (format: NumberFormat, bp: number | null): string => (bp === null ? "—" : `${format.number(bp / 100, { maximumFractionDigits: 1 })} %`);
const hoursToDays = (minutes: number): number => minutes / (8 * 60);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t py-1.5 first:border-t-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

export function EvidencePanel({ evidence, labels }: { evidence: ReviewEvidence; labels: Labels }) {
  const { t, format } = labels;
  const { performance, tasks, attendance, kudos } = evidence;
  const okr = performance.okr;
  const kpi = performance.kpi;
  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
      <header>
        <h2 className="text-sm font-medium">{t("evidence.title", { year: evidence.year })}</h2>
        <p className="text-xs text-muted-foreground">{t("evidence.description")}</p>
      </header>
      <dl className="flex flex-col">
        <Row label={`${t("evidence.okr")} — ${t("evidence.okrIndividual")}`}>
          {percent(format, okr.individual.progressBp)} <span className="text-xs text-muted-foreground">({t("evidence.okrGoals", { count: okr.individual.goals.length })})</span>
        </Row>
        <Row label={`${t("evidence.okr")} — ${t("evidence.okrDepartment")}`}>{percent(format, okr.units.department.progressBp)}</Row>
        <Row label={`${t("evidence.okr")} — ${t("evidence.okrEntity")}`}>{percent(format, okr.units.entity.progressBp)}</Row>
        <Row label={`${t("evidence.okr")} — ${t("evidence.okrGroup")}`}>{percent(format, okr.units.group.progressBp)}</Row>
        <Row label={t("evidence.kpi")}>
          {percent(format, kpi.scoreBp)} <span className="text-xs text-muted-foreground">({kpi.final ? t("evidence.kpiFinal") : t("evidence.kpiMonths", { closed: kpi.closedMonths.length, open: kpi.openMonths.length })})</span>
        </Row>
        <Row label={t("evidence.tasks")}>
          {t("evidence.tasksDone", { count: tasks.completed })} · {t("evidence.tasksOnTime", { count: tasks.onTime })} · {t("evidence.tasksLate", { count: tasks.late })}
          <span className="block text-xs text-muted-foreground">{t("evidence.tasksOpen", { count: tasks.open, overdue: tasks.overdue })}</span>
        </Row>
        <Row label={t("evidence.kudos")}>{t("evidence.kudosCount", { count: kudos.count })}</Row>
        <Row label={t("evidence.attendance")}>
          {t("evidence.attendanceLate", { count: attendance.lateCount })} · {t("evidence.attendanceAbsent", { count: attendance.absentDays })}
          <span className="block text-xs text-muted-foreground">{t("evidence.attendanceLeave", { days: format.number(hoursToDays(attendance.leavePaidMinutes), { maximumFractionDigits: 1 }) })}</span>
        </Row>
      </dl>
      {kudos.recent.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t pt-2">
          {kudos.recent.map((card) => (
            <li key={card.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{card.fromName}</span> — {card.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
