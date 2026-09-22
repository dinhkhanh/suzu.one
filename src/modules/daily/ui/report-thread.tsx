"use client";
// A report's thread: a lead's comment or one-tap reaction, the person's answer.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { commentOnReportAction } from "../actions";
import { REPORT_REACTIONS } from "../enums";
import { TEXTAREA } from "./format";
import { useRun } from "./use-run";

export function ReportThread({ reportId }: { reportId: string }) {
  const t = useTranslations("daily.thread");
  const [body, setBody] = useState("");
  const { run, pending, errorKey } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {REPORT_REACTIONS.map((reaction) => (
          <Button key={reaction} type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(commentOnReportAction, { reportId, reaction })} aria-label={t("react", { reaction })}>
            {reaction}
          </Button>
        ))}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim()) run(commentOnReportAction, { reportId, body }, () => setBody(""));
        }}
      >
        <textarea aria-label={t("comment")} value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} className={TEXTAREA} placeholder={t("placeholder")} />
        <Button type="submit" size="sm" disabled={pending || !body.trim()} className="self-start">
          {t("send")}
        </Button>
      </form>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}
