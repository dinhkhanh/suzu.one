"use client";
// "Deliver to client" (FR-PJM-53): which version went, when, to whom, with the final files or Drive
// links. The approved version is offered first; any other asks the person to confirm.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { recordDeliveryAction, removeDeliveryAction } from "../delivery-actions";
import { DeliveryError, errorKeyOf, type Result } from "./delivery-shared";

export type DeliveryItem = { id: string; version: number | null; deliveredOn: string; recipient: string | null; links: string[]; note: string | null; deliveredByName: string | null; canRemove: boolean };
export type DeliverableChoice = { id: string; version: number; approved: boolean; frozen: boolean };

const textareaClass = "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export function DeliveryPanel({ taskId, deliveries, versions, canRecord, today }: { taskId: string; deliveries: DeliveryItem[]; versions: DeliverableChoice[]; canRecord: boolean; today: string }) {
  const t = useTranslations("work.delivery");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // A removal's error shows under the sheet; the form's, inside the form.
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // The add row folds shut after a delivery is recorded or the form is cancelled: a new key mounts it closed.
  const [addRow, setAddRow] = useState(0);
  // The client-approved version first, then the approved, then the newest.
  const preferred = versions.find((row) => row.frozen) ?? versions.find((row) => row.approved) ?? versions[0];
  const [chosen, setChosen] = useState(preferred?.id ?? "");
  const [confirm, setConfirm] = useState(false);
  const chosenVersion = versions.find((row) => row.id === chosen);
  const unapproved = !!chosenVersion && !chosenVersion.approved && !chosenVersion.frozen;
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: "medium" });
  const run = (call: () => Promise<Result>, done?: () => void, setError: (key: string | null) => void = setErrorKey) =>
    startTransition(async () => {
      const result = await call();
      setError(errorKeyOf(result));
      if (result.ok) {
        done?.();
        router.refresh();
      }
    });
  if (!canRecord && deliveries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <TableCard>
        <TableCardHeader title={t("title")} count={deliveries.length || null} actions={deliveries.length ? <Badge variant="success">{t("delivered")}</Badge> : null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("deliveredOn")}</TableHead>
              <TableHead kind="id">{t("version")}</TableHead>
              <TableHead kind="person">{t("recipient")}</TableHead>
              <TableHead kind="person">{t("recordedBy")}</TableHead>
              <TableHead kind="link">{t("links")}</TableHead>
              <TableHead kind="text">{t("note")}</TableHead>
              {deliveries.some((item) => item.canRemove) ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {deliveries.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{day(item.deliveredOn)}</TableCell>
                <TableCell kind="id">{item.version ? `v${item.version}` : "—"}</TableCell>
                <TableCell>{item.recipient ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{item.deliveredByName ?? "—"}</TableCell>
                <TableCell kind="link" className="max-w-64">
                  {item.links.length ? (
                    <span className="flex flex-col">
                      {item.links.map((link) => (
                        <a key={link} href={link} target="_blank" rel="noopener noreferrer nofollow" className="truncate">
                          {link}
                        </a>
                      ))}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="max-w-64 whitespace-pre-wrap">{item.note ?? "—"}</TableCell>
                {deliveries.some((row) => row.canRemove) ? (
                  <TableCell kind="actions">
                    {item.canRemove ? (
                      <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => window.confirm(t("removeConfirm")) && run(() => removeDeliveryAction({ deliveryId: item.id }))}>
                        {t("remove")}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canRecord ? (
          <TableAddRow key={addRow} label={t("deliver")}>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                run(() => recordDeliveryAction({ taskId, deliverableId: chosen, deliveredOn: data.get("deliveredOn"), recipient: data.get("recipient"), links: data.get("links"), note: data.get("note"), confirmUnapproved: confirm }), () => setAddRow((count) => count + 1), setFormError);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="delivery-version">{t("version")}</Label>
                  <Select
                    id="delivery-version"
                    value={chosen}
                    onChange={(event) => {
                      setChosen(event.target.value);
                      setConfirm(false);
                    }}
                  >
                    <option value="">{t("noVersion")}</option>
                    {versions.map((row) => (
                      <option key={row.id} value={row.id}>
                        v{row.version} {row.frozen ? `· ${t("clientApproved")}` : row.approved ? `· ${t("approved")}` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="delivery-on">{t("deliveredOn")}</Label>
                  <DatePicker id="delivery-on" name="deliveredOn" required defaultValue={today} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="delivery-to">{t("recipient")}</Label>
                  <Input id="delivery-to" name="recipient" maxLength={200} placeholder={t("recipientPlaceholder")} />
                </div>
              </div>
              {unapproved ? (
                <label className="flex items-start gap-2 rounded-lg border border-warning/35 bg-warning/10 p-2 text-sm">
                  <Checkbox checked={confirm} onCheckedChange={(checked) => setConfirm(checked)} className="mt-0.5" />
                  {t("unapprovedWarning", { version: chosenVersion!.version })}
                </label>
              ) : null}
              <div className="flex flex-col gap-1">
                <Label htmlFor="delivery-links">{t("links")}</Label>
                <textarea id="delivery-links" name="links" placeholder={t("linksPlaceholder")} className={textareaClass} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="delivery-note">{t("note")}</Label>
                <Input id="delivery-note" name="note" maxLength={2000} />
              </div>
              <DeliveryError errorKey={formError} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || (unapproved && !confirm)}>
                  {t("save")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFormError(null);
                    setAddRow((count) => count + 1);
                  }}
                >
                  {t("cancel")}
                </Button>
              </div>
            </form>
          </TableAddRow>
        ) : null}
      </TableCard>
      <DeliveryError errorKey={errorKey} />
    </section>
  );
}
