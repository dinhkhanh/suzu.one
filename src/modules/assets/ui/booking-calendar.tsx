// The week the production team looks at (FR-AST-03). A server component: the lane arithmetic is
// the pure `layoutWeek`, so what is left here is the grid and the labels.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import { type BookingStatus } from "../enums";
import { layoutWeek, weekDays } from "../engine/booking";
import type { BookingView } from "../service";

const STATUS_TONE: Record<BookingStatus, string> = {
  requested: "border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100",
  confirmed: "border-emerald-400 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100",
  checked_out: "border-sky-500 bg-sky-50 text-sky-950 dark:bg-sky-950/60 dark:text-sky-100",
  returned: "border-muted bg-muted text-muted-foreground",
  cancelled: "border-muted bg-muted text-muted-foreground line-through",
};

const DAY_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const vietnamDayNumber = (day: Date) => new Date(day.getTime() + 7 * 3_600_000).getUTCDate();
const vietnamMonth = (day: Date) => new Date(day.getTime() + 7 * 3_600_000).getUTCMonth() + 1;
const isoDay = (day: Date) => new Date(day.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export async function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = await getTranslations("assets.bookings.status");
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{t(status)}</span>;
}

export type CalendarQuery = { week?: string; categoryId?: string; entityId?: string };

export async function BookingCalendarFilters({ query, categories, entities }: { query: CalendarQuery; categories: { id: string; name: string }[]; entities: { id: string; code: string; shortName: string | null }[] }) {
  const t = await getTranslations("assets.filters");
  return (
    <form method="get" action="/assets/bookings" className="flex flex-wrap items-end gap-3 rounded-md border p-3">
      {query.week ? <input type="hidden" name="week" value={query.week} /> : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("category")}
        <Select name="categoryId" defaultValue={query.categoryId ?? ""} className="h-9">
          <option value="">{t("any")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("entity")}
        <Select name="entityId" defaultValue={query.entityId ?? ""} className="h-9">
          <option value="">{t("any")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName ?? entity.code}
            </option>
          ))}
        </Select>
      </label>
      <button type="submit" className="h-9 rounded-md border px-3 text-sm">
        {t("apply")}
      </button>
    </form>
  );
}

/**
 * One week, one row per asset. Each row lays its own bookings into lanes, so a camera booked twice
 * on one day shows two bars stacked rather than one drawn over the other.
 */
export async function BookingWeek({ weekBegins, assets, bookings }: { weekBegins: Date; assets: { id: string; code: string; name: string; categoryName: string }[]; bookings: BookingView[] }) {
  const t = await getTranslations("assets.bookings");
  const days = weekDays(weekBegins);
  const today = isoDay(new Date());

  if (assets.length === 0) return <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{t("noGear")}</p>;

  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="min-w-3xl">
        <div className="grid grid-cols-[14rem_repeat(7,minmax(0,1fr))] border-b bg-muted/40 text-xs font-medium">
          <div className="p-2">{t("columns.asset")}</div>
          {days.map((day, index) => (
            <div key={day.toISOString()} className={`p-2 text-center ${isoDay(day) === today ? "text-primary" : "text-muted-foreground"}`}>
              {t(`days.${DAY_LABELS[index]}`)} {vietnamDayNumber(day)}/{vietnamMonth(day)}
            </div>
          ))}
        </div>

        {assets.map((asset) => {
          const mine = bookings.filter((booking) => booking.assetId === asset.id);
          const laid = layoutWeek(mine, weekBegins);
          const lanes = laid.length === 0 ? 1 : Math.max(...laid.map((entry) => entry.lane)) + 1;
          return (
            <div key={asset.id} className="grid grid-cols-[14rem_repeat(7,minmax(0,1fr))] border-b last:border-b-0">
              <div className="border-r p-2 text-sm">
                <Link href={`/assets/${asset.id}`} className="font-medium hover:underline">
                  {asset.code}
                </Link>
                <p className="truncate text-xs text-muted-foreground">{asset.name}</p>
              </div>
              <div className="relative col-span-7" style={{ minHeight: `${lanes * 1.75 + 0.5}rem` }}>
                {/* The seven day cells, drawn behind the bars so the grid stays visible. */}
                <div className="absolute inset-0 grid grid-cols-7">
                  {days.map((day) => (
                    <div key={day.toISOString()} className={`border-r last:border-r-0 ${isoDay(day) === today ? "bg-primary/5" : ""}`} />
                  ))}
                </div>
                {laid.map(({ item, from, to, lane }) => (
                  <Link
                    key={item.id}
                    href={`/assets/bookings/${item.id}`}
                    title={`${item.personName} · ${item.purpose ?? ""}`}
                    className={`absolute truncate rounded border px-1.5 text-xs leading-6 ${STATUS_TONE[item.status]}`}
                    style={{ left: `calc(${(from / 7) * 100}% + 2px)`, width: `calc(${((to - from + 1) / 7) * 100}% - 4px)`, top: `${lane * 1.75 + 0.25}rem`, height: "1.5rem" }}
                  >
                    {item.personName}
                    {item.projectRef ? ` · ${item.projectRef}` : ""}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A plain list of bookings, for the pages that are not a grid: my bookings, the keeper's inbox. */
export async function BookingList({ rows, empty, showAsset = true }: { rows: BookingView[]; empty: string; showAsset?: boolean }) {
  const t = await getTranslations("assets.bookings");
  if (rows.length === 0) return <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            {showAsset ? <th className="p-2 font-medium">{t("columns.asset")}</th> : null}
            <th className="p-2 font-medium">{t("columns.person")}</th>
            <th className="p-2 font-medium">{t("columns.window")}</th>
            <th className="p-2 font-medium">{t("columns.purpose")}</th>
            <th className="p-2 font-medium">{t("columns.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              {showAsset ? (
                <td className="p-2">
                  <Link href={`/assets/bookings/${row.id}`} className="font-medium hover:underline">
                    {row.assetCode}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{row.assetName}</p>
                </td>
              ) : null}
              <td className="p-2">{row.personName}</td>
              <td className="p-2 whitespace-nowrap text-xs">
                {formatWindow(row.startAt, row.endAt)}
              </td>
              <td className="p-2 text-xs text-muted-foreground">
                {row.purpose ?? "—"}
                {row.projectRef ? ` · ${row.projectRef}` : ""}
              </td>
              <td className="p-2">
                <BookingStatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "25/09 09:00 → 25/09 17:00", in Vietnam time, which is where the gear is. */
export function formatWindow(from: Date, to: Date): string {
  const stamp = (value: Date) => {
    const local = new Date(value.getTime() + 7 * 3_600_000);
    const day = String(local.getUTCDate()).padStart(2, "0");
    const month = String(local.getUTCMonth() + 1).padStart(2, "0");
    const hour = String(local.getUTCHours()).padStart(2, "0");
    const minute = String(local.getUTCMinutes()).padStart(2, "0");
    return `${day}/${month} ${hour}:${minute}`;
  };
  return `${stamp(from)} → ${stamp(to)}`;
}
