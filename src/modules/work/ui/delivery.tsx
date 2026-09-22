"use client";
// "Deliver to client" (FR-PJM-53): which version went, when, to whom, with the final files or Drive
// links. The approved version is offered first; any other asks the person to confirm.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // The client-approved version first, then the approved, then the newest.
  const preferred = versions.find((row) => row.frozen) ?? versions.find((row) => row.approved) ?? versions[0];
  const [chosen, setChosen] = useState(preferred?.id ?? "");
  const [confirm, setConfirm] = useState(false);
  const chosenVersion = versions.find((row) => row.id === chosen);
  const unapproved = !!chosenVersion && !chosenVersion.approved && !chosenVersion.frozen;
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: "medium" });
  const run = (call: () => Promise<Result>, done?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(errorKeyOf(result));
      if (result.ok) {
        done?.();
        router.refresh();
      }
    });
  if (!canRecord && deliveries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {t("title")}
        {deliveries.length ? <Badge variant="success">{t("delivered")}</Badge> : null}
      </h2>
      {deliveries.length ? (
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {deliveries.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{day(item.deliveredOn)}</span>
                {item.version ? <span className="font-mono text-xs">v{item.version}</span> : null}
                {item.recipient ? <span className="text-muted-foreground">{t("to", { name: item.recipient })}</span> : null}
                <span className="text-xs text-muted-foreground">{t("by", { name: item.deliveredByName ?? "—" })}</span>
                {item.canRemove ? (
                  <Button type="button" size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => window.confirm(t("removeConfirm")) && run(() => removeDeliveryAction({ deliveryId: item.id }))}>
                    {t("remove")}
                  </Button>
                ) : null}
              </div>
              {item.links.map((link) => (
                <a key={link} href={link} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-sm underline">
                  {link}
                </a>
              ))}
              {item.note ? <p className="whitespace-pre-wrap text-sm">{item.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canRecord ? (
        open ? (
          <form
            className="flex flex-col gap-3 rounded-xl border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => recordDeliveryAction({ taskId, deliverableId: chosen, deliveredOn: data.get("deliveredOn"), recipient: data.get("recipient"), links: data.get("links"), note: data.get("note"), confirmUnapproved: confirm }), () => setOpen(false));
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
                <Input id="delivery-on" name="deliveredOn" type="date" required defaultValue={today} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="delivery-to">{t("recipient")}</Label>
                <Input id="delivery-to" name="recipient" maxLength={200} placeholder={t("recipientPlaceholder")} />
              </div>
            </div>
            {unapproved ? (
              <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
                <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} className="mt-0.5 size-4" />
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
            <DeliveryError errorKey={errorKey} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending || (unapproved && !confirm)}>
                {t("save")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
            {t("deliver")}
          </Button>
        )
      ) : null}
      {!open ? <DeliveryError errorKey={errorKey} /> : null}
    </section>
  );
}
