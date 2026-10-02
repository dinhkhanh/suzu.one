"use client";
// Giving out and taking back the seats of a licence or subscription (FR-AST-11): a seat goes to a
// person, or to a device — the edit suite's seat belongs to the machine, whoever sits at it.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { assignSeatAction, releaseSeatAction } from "../seat-actions";

type SeatFor = "person" | "device";

export function AssignSeatForm({ licenceId, people, devices }: { licenceId: string; people: { id: string; fullName: string }[]; devices: { id: string; code: string; name: string; holderName: string | null }[] }) {
  const t = useTranslations("assets.seats");
  const router = useRouter();
  const [seatFor, setSeatFor] = useState<SeatFor>("person");
  // A new key mounts the form empty once a seat has been given.
  const [round, setRound] = useState(0);
  const [given, setGiven] = useState(false);
  const form = useActionForm(assignSeatAction, {
    extra: { licenceId },
    onSuccess: () => {
      setRound((count) => count + 1);
      setGiven(true);
      router.refresh();
    },
  });
  return (
    <form key={round} onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <Segmented
        size="sm"
        aria-label={t("for")}
        value={seatFor}
        onChange={setSeatFor}
        options={[
          { value: "person", label: t("forPerson") },
          { value: "device", label: t("forDevice") },
        ]}
      />
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          {seatFor === "person" ? (
            <Field name="personId" label={t("person")}>
              <Select id="personId" name="personId" required defaultValue="">
                <option value="">—</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field name="assetId" label={t("device")}>
              <Select id="assetId" name="assetId" required defaultValue="">
                <option value="">—</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.code} — {device.name}
                    {device.holderName ? ` (${device.holderName})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field name="note" label={t("note")}>
            <Input id="seat-note" name="note" maxLength={500} />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace="assets.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("assign")}
        </Button>
        {given && !form.pending && !form.errorKey ? <span className="text-sm text-success">{t("assigned")}</span> : null}
      </div>
    </form>
  );
}

/** Takes one seat back, with a word on why if there is one to say. */
export function ReleaseSeatButton({ seatId }: { seatId: string }) {
  const t = useTranslations("assets.seats");
  const tErrors = useTranslations("assets.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  if (!open)
    return (
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        {t("release")}
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await releaseSeatAction({ seatId, note: data.get("note") });
          setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
          if (result.ok) {
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <Input name="note" maxLength={500} placeholder={t("releaseNote")} aria-label={t("releaseNote")} autoFocus />
      {errorKey ? <Alert variant="destructive">{tErrors.has(errorKey) ? tErrors(errorKey) : tErrors("generic")}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {t("confirmRelease")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("back")}
        </Button>
      </div>
    </form>
  );
}
