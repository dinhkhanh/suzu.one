"use client";
// The forms that move a booking: making one, answering a request, calling one off, and the
// counter's check-out / check-in. Each is a small form of its own rather than one screen with
// modes, because what they refuse differs and the refusal is the interesting part.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { bookAssetAction, cancelBookingAction, checkInBookingAction, checkOutBookingAction, decideBookingAction } from "../actions";
import { ASSET_CONDITIONS, type AssetCondition } from "../enums";

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 text-sm";

export type BookableAsset = { id: string; code: string; name: string; categoryName: string };

/** "2026-09-25T09:00" in Vietnam time, which is what the action reads the field as. */
function vietnamLocalInput(offsetHours: number): string {
  const instant = new Date(Date.now() + offsetHours * 3_600_000 + 7 * 3_600_000);
  return instant.toISOString().slice(0, 16);
}

export function BookAssetForm({ assets, assetId, people, canBookForOthers }: { assets: BookableAsset[]; assetId?: string; people: { id: string; fullName: string }[]; canBookForOthers: boolean }) {
  const t = useTranslations("assets.bookings");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(bookAssetAction, { onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-md border p-4">
      <FieldErrors value={fieldErrors}>
        {assetId ? (
          <input type="hidden" name="assetId" value={assetId} />
        ) : (
          <Field name="assetId" label={t("form.asset")}>
            <Select id="assetId" name="assetId" required defaultValue="">
              <option value="" disabled>
                {t("form.pickAsset")}
              </option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.code} — {asset.name} ({asset.categoryName})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {canBookForOthers ? (
          <Field name="personId" label={t("form.person")}>
            <Select id="personId" name="personId" defaultValue="">
              <option value="">{t("form.myself")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="startAt" label={t("form.from")}>
            <Input id="startAt" name="startAt" type="datetime-local" required defaultValue={vietnamLocalInput(24)} />
          </Field>
          <Field name="endAt" label={t("form.to")}>
            <Input id="endAt" name="endAt" type="datetime-local" required defaultValue={vietnamLocalInput(32)} />
          </Field>
        </div>

        <Field name="purpose" label={t("form.purpose")}>
          <Input id="purpose" name="purpose" maxLength={500} placeholder={t("form.purposeHint")} />
        </Field>
        <Field name="projectRef" label={t("form.projectRef")}>
          <Input id="projectRef" name="projectRef" maxLength={60} placeholder="PRJ-2026-014" />
        </Field>
      </FieldErrors>

      <FormError namespace="assets.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t("form.submit")}
        </Button>
      </div>
    </form>
  );
}

/** The keeper's yes or no. Refusing asks for a reason, because a refusal without one helps nobody. */
export function DecideBookingForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("assets.bookings");
  const router = useRouter();
  const [refusing, setRefusing] = useState(false);
  const { onSubmit, pending, errorKey } = useActionForm(decideBookingAction, { extra: { bookingId }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="toolbar">
      {refusing ? <input type="text" name="note" required maxLength={1000} placeholder={t("decide.reason")} className="h-9 min-w-56 flex-1 rounded-md border bg-transparent px-3 text-sm" /> : null}
      {refusing ? (
        <>
          <Button type="submit" name="decision" value="refuse" variant="destructive" disabled={pending}>
            {t("decide.refuse")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setRefusing(false)}>
            {t("decide.back")}
          </Button>
        </>
      ) : (
        <>
          <Button type="submit" name="decision" value="confirm" disabled={pending}>
            {t("decide.confirm")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setRefusing(true)}>
            {t("decide.refuse")}
          </Button>
        </>
      )}
      <FormError namespace="assets.errors" errorKey={errorKey} />
    </form>
  );
}

export function CancelBookingForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("assets.bookings");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey } = useActionForm(cancelBookingAction, { extra: { bookingId }, onSuccess: () => router.refresh() });

  if (!open)
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t("cancel.open")}
      </Button>
    );
  return (
    <form onSubmit={onSubmit} className="toolbar">
      <input type="text" name="note" maxLength={1000} placeholder={t("cancel.reason")} className="h-9 min-w-56 flex-1 rounded-md border bg-transparent px-3 text-sm" />
      <Button type="submit" variant="destructive" disabled={pending}>
        {t("cancel.submit")}
      </Button>
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>
        {t("decide.back")}
      </Button>
      <FormError namespace="assets.errors" errorKey={errorKey} />
    </form>
  );
}

/** The counter: gear leaves the shelf, and comes back. What state it was in is the whole record. */
export function MoveBookingForm({ bookingId, direction, defaultCondition }: { bookingId: string; direction: "out" | "in"; defaultCondition: AssetCondition }) {
  const t = useTranslations("assets.bookings");
  const conditions = useTranslations("assets.enums.condition");
  const router = useRouter();
  const action = direction === "out" ? checkOutBookingAction : checkInBookingAction;
  const { onSubmit, pending, errorKey } = useActionForm(action, { extra: { bookingId }, onSuccess: () => router.refresh() });
  const field = direction === "out" ? "conditionOut" : "conditionIn";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t(direction === "out" ? "move.conditionOut" : "move.conditionIn")}
          <Select name={field} defaultValue={defaultCondition} className="h-9">
            {ASSET_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {conditions(condition)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("move.note")}
          <textarea name="note" rows={2} maxLength={1000} className={textarea} />
        </label>
      </div>
      <FormError namespace="assets.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {t(direction === "out" ? "move.checkOut" : "move.checkIn")}
        </Button>
      </div>
    </form>
  );
}
