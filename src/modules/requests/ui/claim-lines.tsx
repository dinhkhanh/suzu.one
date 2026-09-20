// An expense claim's lines, read by an approver or by finance (FR-REQ-03). Server component.
//
// Every line shows its receipt as a link that opens through the request's own attachment rule, so
// a receipt is never reachable on a file id alone.
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
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
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t("linesTitle")}</h2>
        <PaymentBadge payment={payment} />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("lineDate")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("category")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("description")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("projectTag")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("receipt")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{format.dateTime(new Date(`${line.lineDate}T00:00:00`), { dateStyle: "medium" })}</td>
                <td className="px-3 py-2 whitespace-nowrap">{t(`categories.${line.category}` as "categories.other")}</td>
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2 text-muted-foreground">{line.projectTag ?? "—"}</td>
                <td className="px-3 py-2">{line.receiptFileId ? <AttachmentLink requestId={requestId} fileId={line.receiptFileId} fileName={fileNames.get(line.receiptFileId) ?? t("receipt")} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-medium">
              <td className="px-3 py-2" colSpan={5}>
                {t("totalLabel")}
              </td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

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
