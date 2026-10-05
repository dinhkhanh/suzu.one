"use client";
// HR's side of the professional fields and skills: the dialog that corrects one entry of the
// catalogue (or removes it), and the row that adds one. The list itself is the page's table.
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TableAddRow } from "@/components/ui/table";
import { addCompetencyAction, deleteCompetencyAction, updateCompetencyAction } from "../competency-actions";
import { COMPETENCY_KINDS, MAX_COMPETENCY_NAME } from "../enums";
import { ConfirmButton } from "@/components/ui/confirm";

type Entry = { id: string; kind: (typeof COMPETENCY_KINDS)[number]; name: string; holders: number };

function EntryFields({ entry, prefix }: { entry?: Entry; prefix: string }) {
  const t = useTranslations("people");
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
      <Field name={`${prefix}-name`} label={t("competencies.name")}>
        <Input id={`${prefix}-name`} name="name" required maxLength={MAX_COMPETENCY_NAME} defaultValue={entry?.name ?? ""} autoComplete="off" />
      </Field>
      <Field name={`${prefix}-kind`} label={t("competencies.kind")}>
        <Select id={`${prefix}-kind`} name="kind" defaultValue={entry?.kind ?? "profession"}>
          {COMPETENCY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`competencies.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** "Edit" on a row: the name and the kind, and the way to remove the entry. Saving closes the dialog; the row shows the result. */
export function EditCompetencyButton({ entry }: { entry: Entry }) {
  const t = useTranslations("people");
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey } = useActionForm(updateCompetencyAction, { extra: { competencyId: entry.id }, onSuccess: () => setOpen(false) });
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  function remove() {
    startRemoving(async () => {
      const result = await deleteCompetencyAction({ competencyId: entry.id });
      if (result.ok) setOpen(false);
      else setRemoveError((result.error === "failed" ? result.message : result.error) ?? "generic");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" aria-label={t("competencies.editTitle", { name: entry.name })} />}>
        <PencilIcon />
        <span className="hidden sm:inline">{t("competencies.editItem")}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("competencies.editTitle", { name: entry.name })}</DialogTitle>
          <DialogDescription>{t("competencies.editHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <EntryFields entry={entry} prefix={`edit-${entry.id}`} />
          <FormError namespace="people.errors" errorKey={errorKey ?? removeError} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="submit" disabled={pending || removing}>
              {pending ? t("saving") : t("save")}
            </Button>
            <ConfirmButton variant="ghost" className="text-destructive" destructive disabled={pending || removing} label={t("competencies.delete")} question={t("competencies.deleteConfirm", { name: entry.name, count: entry.holders })} onConfirm={remove} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The row that closes the table: a new entry before anybody holds it. Saved, the panel closes and the entry is in the list. */
export function AddCompetencyRow() {
  const t = useTranslations("people");
  const details = useRef<HTMLDetailsElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(addCompetencyAction, {
    onSuccess: () => {
      details.current?.removeAttribute("open");
      form.current?.reset();
    },
  });
  return (
    <TableAddRow label={t("competencies.add")} ref={details}>
      <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
        <EntryFields prefix="add" />
        <FormError namespace="people.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </TableAddRow>
  );
}
