// The week the production team looks at (FR-AST-03). A server component: the lane arithmetic is
// the pure `layoutWeek`, so what is left here is the grid and the labels.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { cn } from "cn";
import { type BookingStatus } from "../enums";
import { layoutWeek, weekDays } from "../engine/booking";
import type { BookingView } from "../service";
import { RecordLink } from "@/components/ui/record-link";

// A booking on the grid: a small tinted block in the tone of its status — waiting amber, confirmed
// green, out of the cupboard blue, back or cancelled grey.
const BLOCK_TONE: Record<BookingStatus, string> = {
  requested: "bg-warning/12 text-warning hover:bg-warning/20",
  confirmed: "bg-success/10 text-success hover:bg-success/18",
  checked_out: "bg-primary/10 text-primary hover:bg-primary/18",
  returned: "bg-muted text-muted-foreground hover:bg-accent",
  cancelled: "bg-muted text-faint line-through hover:bg-accent",
};

const DAY_LABELS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const vietnamDayNumber = (day: Date) => new Date(day.getTime() + 7 * 3_600_000).getUTCDate();
const vietnamMonth = (day: Date) => new Date(day.getTime() + 7 * 3_600_000).getUTCMonth() + 1;
const isoDay = (day: Date) => new Date(day.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export async function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = await getTranslations("assets.bookings.status");
  return (
    <Badge dot variant={statusTone(status)}>
      {t(status)}
    </Badge>
  );
}

export type CalendarQuery = { week?: string; categoryId?: string; entityId?: string };

export async function BookingCalendarFilters({ query, categories, entities }: { query: CalendarQuery; categories: { id: string; name: string }[]; entities: { id: string; code: string; shortName: string | null }[] }) {
  const t = await getTranslations("assets.filters");
  return (
    <form method="get" action="/assets/bookings" className="toolbar">
      {query.week ? <input type="hidden" name="week" value={query.week} /> : null}
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-44">
        {t("category")}
        <Select name="categoryId" defaultValue={query.categoryId ?? ""}>
          <option value="">{t("any")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </Label>
      <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-40">
        {t("entity")}
        <Select name="entityId" defaultValue={query.entityId ?? ""}>
          <option value="">{t("any")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName ?? entity.code}
            </option>
          ))}
        </Select>
      </Label>
      <Button type="submit" variant="outline">
        {t("apply")}
      </Button>
    </form>
  );
}

/**
 * One week, one row per asset. Each row lays its own bookings into lanes, so a camera booked twice
 * on one day shows two blocks stacked rather than one drawn over the other.
 */
export async function BookingWeek({ weekBegins, assets, bookings }: { weekBegins: Date; assets: { id: string; code: string; name: string; categoryName: string }[]; bookings: BookingView[] }) {
  const t = await getTranslations("assets.bookings");
  const days = weekDays(weekBegins);
  const today = isoDay(new Date());
  const LANE = 2; // rem: a 1.75rem block and its gap

  return (
    <Table numbered={false} className="min-w-3xl table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead kind="text" className="w-48">
            {t("columns.asset")}
          </TableHead>
          {days.map((day, index) => (
            <TableHead key={day.toISOString()} className={cn("text-center", isoDay(day) === today && "text-primary")}>
              <span className="font-mono text-[0.6875rem] tabular-nums">
                {t(`days.${DAY_LABELS[index]}`)} {vietnamDayNumber(day)}/{vietnamMonth(day)}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.length === 0 ? <TableEmpty>{t("noGear")}</TableEmpty> : null}
        {assets.map((asset) => {
          const mine = bookings.filter((booking) => booking.assetId === asset.id);
          const laid = layoutWeek(mine, weekBegins);
          const lanes = laid.length === 0 ? 1 : Math.max(...laid.map((entry) => entry.lane)) + 1;
          return (
            <TableRow key={asset.id}>
              <TableCell className="align-top">
                <RecordLink kind="asset" id={asset.id} className="font-mono text-xs font-medium">
                  {asset.code}
                </RecordLink>
                <p className="truncate text-xs text-faint">{asset.name}</p>
              </TableCell>
              <TableCell colSpan={7} className="relative p-0 align-top">
                {/* The seven day cells, drawn behind the blocks so the grid stays visible. */}
                <div className="absolute inset-0 grid grid-cols-7">
                  {days.map((day) => (
                    <div key={day.toISOString()} className={cn("border-r border-border/70 last:border-r-0", isoDay(day) === today && "bg-primary/5")} />
                  ))}
                </div>
                <div aria-hidden style={{ minHeight: `${lanes * LANE + 0.5}rem` }} />
                {laid.map(({ item, from, to, lane }) => (
                  <Link
                    key={item.id}
                    href={`/assets/bookings/${item.id}`}
                    title={`${item.personName} · ${item.purpose ?? ""}`}
                    className={cn("press absolute flex h-7 items-center truncate rounded-md px-2 text-xs font-medium transition-colors", BLOCK_TONE[item.status])}
                    style={{ left: `calc(${(from / 7) * 100}% + 3px)`, width: `calc(${((to - from + 1) / 7) * 100}% - 6px)`, top: `${lane * LANE + 0.25}rem` }}
                  >
                    <span className="truncate">
                      {item.personName}
                      {item.projectRef ? ` · ${item.projectRef}` : ""}
                    </span>
                  </Link>
                ))}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** A plain list of bookings, for the pages that are not a grid: my bookings, the keeper's inbox. */
export async function BookingList({ rows, empty, showAsset = true }: { rows: BookingView[]; empty: string; showAsset?: boolean }) {
  const t = await getTranslations("assets.bookings");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showAsset ? <TableHead kind="text">{t("columns.asset")}</TableHead> : null}
          <TableHead kind="person">{t("columns.person")}</TableHead>
          <TableHead kind="time" className="text-left">
            {t("columns.window")}
          </TableHead>
          <TableHead kind="text">{t("columns.purpose")}</TableHead>
          <TableHead kind="status">{t("columns.status")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? <TableEmpty>{empty}</TableEmpty> : null}
        {rows.map((row) => (
          <TableRow key={row.id}>
            {showAsset ? (
              <TableCell className="max-w-64">
                <RecordLink kind="booking" id={row.id} className="font-mono text-xs font-medium">
                  {row.assetCode}
                </RecordLink>
                <p className="truncate text-xs text-faint">
                  <RecordLink kind="asset" id={row.assetId}>
                    {row.assetName}
                  </RecordLink>
                </p>
              </TableCell>
            ) : null}
            <TableCell>
              <RecordLink kind="person" id={row.personId}>
                {row.personName}
              </RecordLink>
            </TableCell>
            <TableCell className="font-mono text-xs tabular-nums">{formatWindow(row.startAt, row.endAt)}</TableCell>
            <TableCell className="max-w-80 truncate text-xs text-muted-foreground">
              {row.purpose ?? "—"}
              {row.projectRef ? ` · ${row.projectRef}` : ""}
            </TableCell>
            <TableCell>
              <BookingStatusBadge status={row.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
