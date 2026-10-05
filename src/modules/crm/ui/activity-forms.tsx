"use client";
// Activities and follow-ups (FR-CRM-06): log what happened, plan what is next — both in one form,
// because "called, send the proposal Friday" is one thought — and finish, move or drop a follow-up.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import { cancelFollowUpAction, completeFollowUpAction, recordActivityAction, rescheduleFollowUpAction } from "../account-actions";
import { ACTIVITY_KINDS } from "../enums";
import { CrmButton, CrmForm, type Named, type Person } from "./common";

type Target = { clientId?: string | null; dealId?: string | null; leadId?: string | null };

export function LogActivityForm({ target, contacts, people, meId, today }: { target: Target; contacts: Named[]; people: Person[]; meId: string; today: string }) {
  const t = useTranslations("crm.activity");
  const tEnums = useTranslations("crm.enums");
  const [logged, setLogged] = useState(true);
  const [plan, setPlan] = useState(false);
  return (
    <CrmForm action={recordActivityAction} extra={{ clientId: target.clientId ?? "", dealId: target.dealId ?? "", leadId: target.leadId ?? "", logged: logged ? "on" : "" }} submit={t("save")}>
      <Segmented
        size="sm"
        className="self-start"
        aria-label={t("mode")}
        value={logged ? "happened" : "plan"}
        options={[
          { value: "happened", label: t("happened") },
          { value: "plan", label: t("planOnly") },
        ]}
        onChange={(value) => {
          setLogged(value === "happened");
          if (value === "plan") setPlan(true);
        }}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="kind" label={t("kind")}>
          <Select id="activity-kind" name="kind" defaultValue="call">
            {ACTIVITY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {tEnums(`activityKind.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field name="subject" label={t("subject")}>
            <Input id="activity-subject" name="subject" required maxLength={200} placeholder={t("subjectHint")} />
          </Field>
        </div>
      </div>
      {contacts.length ? (
        <Field name="contactId" label={t("contact")}>
          <Select id="activity-contact" name="contactId" defaultValue="">
            <option value="">—</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {logged ? (
        <>
          <Field name="body" label={t("body")}>
            <NoteEditor id="activity-body" name="body" rows={2} maxLength={4000} />
          </Field>
          <Field name="outcome" label={t("outcome")}>
            <Input id="activity-outcome" name="outcome" maxLength={1000} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={plan} onChange={(event) => setPlan(event.target.checked)} /> {t("alsoPlan")}
          </label>
        </>
      ) : null}
      {plan || !logged ? (
        <div className="grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-3">
          {logged ? (
            <Field name="followUpSubject" label={t("nextStep")}>
              <Input id="activity-next" name="followUpSubject" maxLength={200} />
            </Field>
          ) : null}
          <Field name="followUpOn" label={t("dueOn")}>
            <DatePicker id="activity-due" name="followUpOn" required min={today} defaultValue={today} />
          </Field>
          <Field name="followUpOwnerId" label={t("owner")}>
            <Select id="activity-owner" name="followUpOwnerId" defaultValue={meId}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
    </CrmForm>
  );
}

/** Done: what came of it, what kind it turned out to be, and optionally the next step. */
export function CompleteFollowUpForm({ activityId, people, meId, today }: { activityId: string; people: Person[]; meId: string; today: string }) {
  const t = useTranslations("crm.activity");
  const tEnums = useTranslations("crm.enums");
  const [next, setNext] = useState(false);
  return (
    <CrmForm action={completeFollowUpAction} extra={{ activityId }} submit={t("markDone")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field name="outcome" label={t("outcome")}>
            <Input id={`outcome-${activityId}`} name="outcome" maxLength={1000} />
          </Field>
        </div>
        <Field name="kind" label={t("kind")}>
          <Select id={`kind-${activityId}`} name="kind" defaultValue="">
            <option value="">—</option>
            {ACTIVITY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {tEnums(`activityKind.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={next} onChange={(event) => setNext(event.target.checked)} /> {t("alsoPlan")}
      </label>
      {next ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="nextSubject" label={t("nextStep")}>
            <Input id={`next-${activityId}`} name="nextSubject" required maxLength={200} />
          </Field>
          <Field name="nextOn" label={t("dueOn")}>
            <DatePicker id={`nexton-${activityId}`} name="nextOn" required min={today} defaultValue={today} />
          </Field>
          <Field name="nextOwnerId" label={t("owner")}>
            <Select id={`nextowner-${activityId}`} name="nextOwnerId" defaultValue={meId}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
    </CrmForm>
  );
}

export function RescheduleForm({ activityId, subject, dueOn, ownerPersonId, people }: { activityId: string; subject: string; dueOn: string; ownerPersonId: string; people: Person[] }) {
  const t = useTranslations("crm.activity");
  return (
    <CrmForm action={rescheduleFollowUpAction} extra={{ activityId }} submit={t("reschedule")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="subject" label={t("subject")}>
          <Input id={`resubject-${activityId}`} name="subject" required maxLength={200} defaultValue={subject} />
        </Field>
        <Field name="dueOn" label={t("dueOn")}>
          <DatePicker id={`redue-${activityId}`} name="dueOn" required defaultValue={dueOn} />
        </Field>
        <Field name="ownerPersonId" label={t("owner")}>
          <Select id={`reowner-${activityId}`} name="ownerPersonId" defaultValue={ownerPersonId}>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </CrmForm>
  );
}

export function CancelFollowUpButton({ activityId }: { activityId: string }) {
  const t = useTranslations("crm.activity");
  return <CrmButton action={cancelFollowUpAction} input={{ activityId }} label={t("drop")} variant="ghost" confirm={t("dropConfirm")} />;
}
