"use client";
// Đúng / sai under an answer (Phase 13 R5, FR-AGT-51). A thumb opens a short note and the choice to
// share the question and the answer with the people who keep the assistant; without that tick they
// read the verdict and the note alone. Given again, it changes what was given.
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { giveFeedbackAction } from "../actions";
import { FEEDBACK_NOTE_MAX, type FeedbackVerdict } from "../enums";

export function AnswerFeedback({ messageId, given }: { messageId: string; given: FeedbackVerdict | null }) {
  const t = useTranslations("assistant.feedback");
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(given);
  const [open, setOpen] = useState<FeedbackVerdict | null>(null);
  const [thanked, setThanked] = useState(false);
  const form = useActionForm(giveFeedbackAction, {
    extra: { messageId, verdict: open },
    onSuccess: (data) => {
      setVerdict(data.verdict);
      setOpen(null);
      setThanked(true);
    },
  });

  const thumb = (value: FeedbackVerdict) => {
    const Icon = value === "right" ? ThumbsUpIcon : ThumbsDownIcon;
    const chosen = (open ?? verdict) === value;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t(value)}
        aria-pressed={chosen}
        title={t(value)}
        className={cn("text-faint hover:text-foreground", chosen && "bg-muted text-foreground")}
        onClick={() => {
          setThanked(false);
          setOpen(open === value ? null : value);
        }}
      >
        <Icon className={cn(chosen && "fill-current")} />
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="-ml-1.5 flex items-center gap-0.5">
        {thumb("right")}
        {thumb("wrong")}
        {thanked ? <span className="ml-1.5 text-xs text-muted-foreground">{t("thanks")}</span> : null}
      </div>
      {open ? (
        <form onSubmit={form.onSubmit} className="flex flex-col gap-2.5 rounded-[14px] border border-border p-3">
          <label htmlFor={`feedback-${messageId}`} className="text-xs font-medium">
            {open === "wrong" ? t("noteWrong") : t("noteRight")}
          </label>
          <Textarea id={`feedback-${messageId}`} name="note" rows={2} maxLength={FEEDBACK_NOTE_MAX} placeholder={t("placeholder")} />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox name="shared" value="1" className="mt-px" />
            <span>{t("share")}</span>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={form.pending}>
              {t("send")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>
              {t("cancel")}
            </Button>
          </div>
          <FormError namespace="assistant.errors" errorKey={form.errorKey} />
        </form>
      ) : null}
    </div>
  );
}
