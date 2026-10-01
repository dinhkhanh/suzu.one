// An expense claim's lines, read by an approver or by finance (FR-REQ-03). Server component.
//
// Every line shows its receipt as a link that opens through the request's own attachment rule, so
// a receipt is never reachable on a file id alone.
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ClaimPayment } from "../expense-posting";
import type { ExpenseClaimLineRow } from "../expense";
import { AttachmentLink } from "./attachment-link";

export async function ClaimLines({
  lines,
  total,
  byCategory,
  payment,
  requestId,
  fileNames,
}: {
  lines: ExpenseClaimLineRow[];
  total: number;
  byCategory: { category: string; amount: number }[];
  payment: ClaimPayment;
  requestId: string;
  fileNames: ReadonlyMap<string, string>;
}) {
  const t = await getTranslations("requests.expense");
  const format = await getFormatter();
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });

  return (
    <section className="flex flex-col gap-3">
      <TableCard>
        <TableCardHeader title={t("linesTitle")} actions={<PaymentBadge payment={payment} />} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("lineDate")}</TableHead>
              <TableHead kind="select">{t("category")}</TableHead>
              <TableHead kind="text">{t("description")}</TableHead>
              <TableHead kind="text">{t("projectTag")}</TableHead>
              <TableHead kind="file">{t("receipt")}</TableHead>
              <TableHead kind="money">{t("amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{format.dateTime(new Date(`${line.lineDate}T00:00:00`), { dateStyle: "medium" })}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`categories.${line.category}` as "categories.other")}</Badge>
                </TableCell>
                <TableCell className="min-w-48 whitespace-normal">{line.description}</TableCell>
                <TableCell className="text-muted-foreground">{line.projectTag ?? "—"}</TableCell>
                <TableCell>{line.receiptFileId ? <AttachmentLink requestId={requestId} fileId={line.receiptFileId} fileName={fileNames.get(line.receiptFileId) ?? t("receipt")} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell kind="money">{money(line.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5}>{t("totalLabel")}</TableCell>
              <TableCell kind="money">{money(total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableCard>

      {byCategory.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          {byCategory.map((row) => `${t(`categories.${row.category}` as "categories.other")} ${money(row.amount)}`).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

async function PaymentBadge({ payment }: { payment: ClaimPayment }) {
  const t = await getTranslations("requests.expense");
  if (payment.state === "not_payable") return null;
  if (payment.state === "awaiting_payroll") return <Badge variant="outline">{t("awaitingPayroll")}</Badge>;
  return <Badge variant="secondary">{t("postedTo", { month: payment.month })}</Badge>;
}
