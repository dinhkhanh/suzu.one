"use client";
import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { remindAction } from "../actions";
import { useRun } from "./use-run";

/** One tap reminds one person, or everyone still missing; a second tap on the same day tells nobody again. */
export function RemindButton({ date, personIds, label, done }: { date: string; personIds: string[]; label: string; done?: boolean }) {
  const t = useTranslations("daily.board");
  const [sent, setSent] = useState(done ?? false);
  const { run, pending, errorKey } = useRun();
  if (personIds.length === 0) return null;
  return (
    <>
      <Button type="button" size="xs" variant={sent ? "ghost" : "outline"} disabled={pending || sent} onClick={() => run(remindAction, { date, personIds }, () => setSent(true))}>
        <BellRing aria-hidden /> {sent ? t("reminded") : label}
      </Button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </>
  );
}
