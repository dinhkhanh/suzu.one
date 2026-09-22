"use client";
// The forms of the Team tab (FR-PJM-13): book a person or a placeholder role for a run of weeks,
// change or remove one booking, fill a placeholder with a person. Each posts to a server action that
// re-checks that the viewer runs the project.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { bookAction, deleteBookingAction, fillPlaceholderAction, updateBookingAction } from "../actions";
import { ActionButton, ActionForm } from "./plan-forms";

type Person = { id: string; fullName: string };
type WeekOption = { start: string; label: string };
const hoursOf = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);

export function BookForm({ projectId, people, weeks }: { projectId: string; people: Person[]; weeks: WeekOption[] }) {
  const t = useTranslations("projects.bookings");
  const [who, setWho] = useState<"person" | "placeholder">("person");
  return (
    <ActionForm action={bookAction} extra={{ projectId }} submit={t("book")}>
      <div role="radiogroup" aria-label={t("who")} className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="whoKind" checked={who === "person"} onChange={() => setWho("person")} /> {t("aPerson")}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="whoKind" checked={who === "placeholder"} onChange={() => setWho("placeholder")} /> {t("aPlaceholder")}
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_11rem_6rem_6rem_9rem]">
        {who === "person" ? (
          <Field name="personId" label={t("person")}>
            <Select id="book-person" name="personId" required defaultValue="">
              <option value="" disabled>
                {t("pickPerson")}
              </option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field name="placeholderRole" label={t("placeholderRole")}>
            <Input id="book-role" name="placeholderRole" required maxLength={80} placeholder={t("placeholderHint")} />
          </Field>
        )}
        <Field name="weekStart" label={t("fromWeek")}>
          <Select id="book-week" name="weekStart" defaultValue={weeks[0]?.start}>
            {weeks.map((week) => (
              <option key={week.start} value={week.start}>
                {week.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="hours" label={t("hoursPerWeek")}>
          <Input id="book-hours" name="hours" type="number" min={0.5} max={80} step="0.5" required defaultValue="8" />
        </Field>
        <Field name="weeks" label={t("forWeeks")}>
          <Input id="book-weeks" name="weeks" type="number" min={1} max={26} defaultValue="1" />
        </Field>
        <Field name="status" label={t("status")}>
          <Select id="book-status" name="status" defaultValue="confirmed">
            <option value="confirmed">{t("statuses.confirmed")}</option>
            <option value="tentative">{t("statuses.tentative")}</option>
          </Select>
        </Field>
      </div>
      <Field name="note" label={t("note")}>
        <Input id="book-note" name="note" maxLength={300} />
      </Field>
    </ActionForm>
  );
}

export function BookingEditor({ booking }: { booking: { id: string; minutes: number; status: string; note: string | null; weekLabel: string } }) {
  const t = useTranslations("projects.bookings");
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2 sm:flex-row sm:items-end sm:gap-3">
      <span className="text-xs text-muted-foreground sm:w-28 sm:pb-2">{booking.weekLabel}</span>
      <ActionForm action={updateBookingAction} extra={{ bookingId: booking.id }} submit={t("save")} className="flex flex-1 flex-wrap items-end gap-2">
        <Field name="hours" label={t("hours")}>
          <Input id={`booking-hours-${booking.id}`} name="hours" type="number" min={0.5} max={80} step="0.5" defaultValue={hoursOf(booking.minutes)} className="w-24" />
        </Field>
        <Field name="status" label={t("status")}>
          <Select id={`booking-status-${booking.id}`} name="status" defaultValue={booking.status} className="w-36">
            <option value="confirmed">{t("statuses.confirmed")}</option>
            <option value="tentative">{t("statuses.tentative")}</option>
          </Select>
        </Field>
        <Field name="note" label={t("note")}>
          <Input id={`booking-note-${booking.id}`} name="note" maxLength={300} defaultValue={booking.note ?? ""} className="w-48" />
        </Field>
      </ActionForm>
      <ActionButton action={deleteBookingAction} input={{ bookingId: booking.id }} label={t("remove")} confirm={t("removeConfirm")} variant="ghost" />
    </div>
  );
}

export function FillPlaceholderForm({ projectId, role, people }: { projectId: string; role: string; people: Person[] }) {
  const t = useTranslations("projects.bookings");
  return (
    <ActionForm action={fillPlaceholderAction} extra={{ projectId, placeholderRole: role }} submit={t("fill")} className="flex flex-wrap items-end gap-2">
      <Field name="personId" label={t("fillWith", { role })}>
        <Select id={`fill-${role}`} name="personId" required defaultValue="" className="w-56">
          <option value="" disabled>
            {t("pickPerson")}
          </option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName}
            </option>
          ))}
        </Select>
      </Field>
    </ActionForm>
  );
}
