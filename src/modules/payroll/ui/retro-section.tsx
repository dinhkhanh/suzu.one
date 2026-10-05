// The retro items of an entity (FR-PAY-17), as C&B work with them: what is waiting for a run or
// already in one, where each came from, and — below — the attendance corrections the system could
// not turn into money, for C&B to enter by hand. Shown on a run's page (its own items) and on the
// retro page (everything still open). A server component: the amounts reach the browser as text.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { storedText } from "@/lib/stored-text";
import type { RetroScreen } from "../run-views";
import { formatVnd } from "./money";
import { AddRetroItemRow, CancelRetroItemButton, DeriveRetroButton, UnpricedAdjustmentForm } from "./retro-forms";

type Props = {
  screen: RetroScreen;
  entityId: string;
  /** Set on a run's page: the forms refresh it, and "in this run" means this one. */
  runId?: string | null;
  /** Items may be added, cancelled and looked for. False once the run is past editing. */
  editable: boolean;
  /** Who a hand-entered item may be for. */
  people: { personId: string; fullName: string }[];
  /** Nobody cancels a difference in their own pay; their own row offers nothing. */
  viewerPersonId: string;
  action?: React.ReactNode;
};

/** "+1.500.000 đ" owed to the person, "−500.000 đ" to recover: the sign is the point. */
const signed = (amount: number) => `${amount > 0 ? "+" : "−"}${formatVnd(Math.abs(amount))}`;

export async function RetroSection({ screen, entityId, runId, editable, people, viewerPersonId, action }: Props) {
  const [t, tStored, format] = await Promise.all([getTranslations("payroll.retro"), getTranslations("stored"), getFormatter()]);
  const { items, unpriced } = screen;
  const day = (value: Date) => format.dateTime(value, { dateStyle: "medium" });

  return (
    <Section
      title={t("title")}
      count={items.length || undefined}
      description={t(runId ? "hintRun" : "hint")}
      action={
        <>
          {action}
          {editable ? <DeriveRetroButton entityId={entityId} runId={runId} /> : null}
        </>
      }
    >
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("person")}</TableHead>
              <TableHead kind="date">{t("sourceMonth")}</TableHead>
              <TableHead kind="select">{t("source")}</TableHead>
              <TableHead kind="text">{t("reason")}</TableHead>
              <TableHead kind="money">{t("amount")}</TableHead>
              <TableHead kind="status">{t("status")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? <TableEmpty>{t(runId ? "emptyRun" : "empty")}</TableEmpty> : null}
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">
                  <RecordLink kind="person" id={item.personId}>{item.fullName}</RecordLink>
                  {item.employeeCode ? <span className="ml-2 font-mono text-xs font-normal text-faint">{item.employeeCode}</span> : null}
                </TableCell>
                <TableCell className="font-mono tabular-nums">{item.sourceMonth}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{t(`kinds.${item.kind}`)}</Badge>
                    {/* The decision the difference came from: the same document the person can read. */}
                    {item.kind === "salary_change" && item.sourceRef ? (
                      <Link href={`/payroll/salaries/decisions/${item.sourceRef}`} className="text-xs text-link hover:underline">
                        {t("openDecision")}
                      </Link>
                    ) : null}
                    {item.insuranceBaseChanged ? <Badge variant="warning">{t("insuranceBaseChanged")}</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal">
                  {storedText(item.reason ?? null, tStored)}
                  <span className="block text-xs text-faint">
                    {item.createdByPersonId ? (
                      <>
                        <RecordLink kind="person" id={item.createdByPersonId}>{item.createdByName ?? "—"}</RecordLink> ·{" "}
                      </>
                    ) : (
                      `${t("bySystem")} · `
                    )}
                    {day(item.createdAt)}
                  </span>
                </TableCell>
                <TableCell kind="money" className={item.amount < 0 ? "text-destructive" : undefined}>{signed(item.amount)}</TableCell>
                <TableCell>
                  {item.status === "taken" ? (
                    <Badge dot variant="success">{t(runId ? "statuses.takenHere" : "statuses.taken")}</Badge>
                  ) : item.inRun ? (
                    <Badge dot variant="warning">{t("statuses.open")}</Badge>
                  ) : (
                    <Badge dot variant="outline">{t("statuses.outsideRun")}</Badge>
                  )}
                </TableCell>
                <TableCell kind="actions">{editable && item.personId !== viewerPersonId ? <CancelRetroItemButton id={item.id} runId={runId} name={item.fullName} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {editable ? <AddRetroItemRow entityId={entityId} runId={runId} people={people} lastMonth={todayInVietnam().slice(0, 7)} /> : null}
      </TableCard>

      {/* ── Corrections nobody could price: the month was never run here ── */}
      {unpriced.length > 0 ? (
        <>
          <p className="px-0.5 text-[0.8125rem] text-muted-foreground">{t("unpriced.hint")}</p>
          <List>
            {unpriced.map((row) => (
              <ListItem key={row.adjustmentId} className="flex-col items-stretch gap-2 md:flex-row md:items-end md:justify-between">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <RecordLink kind="person" id={row.personId} className="font-medium">
                      {row.fullName}
                    </RecordLink>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{row.sourceMonth}</span>
                    <Badge variant="warning">{t(`skips.${row.skip}`)}</Badge>
                  </span>
                  <span className="text-sm text-muted-foreground">{row.reason}</span>
                </span>
                {editable && row.personId !== viewerPersonId ? <UnpricedAdjustmentForm entityId={entityId} runId={runId} adjustmentId={row.adjustmentId} personId={row.personId} sourceMonth={row.sourceMonth} reason={row.reason} /> : null}
              </ListItem>
            ))}
          </List>
        </>
      ) : null}
    </Section>
  );
}
