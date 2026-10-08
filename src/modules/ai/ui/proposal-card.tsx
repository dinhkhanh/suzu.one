"use client";
// A proposal, as the asker decides it (Phase 13 R4, D37, FR-AGT-20, 22): what will be set, field by
// field, each name linked to its record; who will be told; and the three ways out — Xác nhận runs the
// module's own action as the person, Sửa opens the module's own form filled in, Bỏ throws it away.
// Nothing on this card changes anything until the person presses Xác nhận.
import { CheckIcon, SparklesIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import type { ActionResult } from "@/lib/action";
import { openQuickCreate } from "@/components/shell/palette-bus";
import { PALETTE_CREATE, type ProposalField, type ProposalShown, type ProposalState } from "../enums";
import { confirmProposalAction, discardProposalAction } from "../proposal-actions";

type Decided = { id: string; state: ProposalState; resultHref: string | null; error: string | null; reason: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** Sửa: a link to the module's form, or — for a task — the palette's create form, filled in. */
function EditButton({ href, label, small }: { href: string; label: string; small?: boolean }) {
  if (href.startsWith(PALETTE_CREATE)) {
    const params = new URLSearchParams(href.slice(PALETTE_CREATE.length));
    return (
      // `data-sheet-close`: opened from the assistant's sheet, the sheet steps aside for the palette.
      <Button
        type="button"
        data-sheet-close=""
        variant="outline"
        size={small ? "sm" : "default"}
        className={small ? "self-start" : undefined}
        onClick={() => openQuickCreate({ title: params.get("title") ?? undefined, dueDate: params.get("dueDate") ?? undefined, place: params.get("place") ?? undefined, mine: params.get("mine") === "1" })}
      >
        {label}
      </Button>
    );
  }
  return (
    <Button nativeButton={false} variant="outline" size={small ? "sm" : "default"} className={small ? "self-start" : undefined} render={<Link href={href} />}>
      {label}
    </Button>
  );
}

export function ProposalCard({ proposal }: { proposal: ProposalShown }) {
  const t = useTranslations("assistant.agent.proposal");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const [shown, setShown] = useState(proposal);
  const [pending, startTransition] = useTransition();

  const decide = (action: (input: unknown) => Promise<ActionResult<Decided>>) =>
    startTransition(async () => {
      const result = await action({ id: shown.id, locale });
      if (result.ok) setShown((before) => ({ ...before, ...result.data }));
      else {
        const error = (result.error === "failed" ? result.message : result.error) ?? "generic";
        setShown((before) => ({ ...before, state: error === "ai_proposal_expired" ? "expired" : before.state, error, reason: null }));
      }
      // The record it made is on the asker's screens now; the conversation's card state too.
      router.refresh();
    });

  // A module's refusal comes in its own words from the server (`reason`); the card's own reasons, or the general line.
  const errorText = (key: string) => shown.reason ?? (t.has(`errors.${key}`) ? t(`errors.${key}`) : t("errors.generic"));

  const value = (field: ProposalField) => {
    if (field.valueKey) return t(`values.${field.valueKey}`, field.params ?? {});
    const text = field.text ?? "";
    return DAY.test(text) ? format.dateTime(new Date(`${text}T00:00:00`), { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }) : text;
  };

  // An action's name holds dots, which the message files read as nesting.
  const actionKey = shown.action.replaceAll(".", "_");
  const title = t.has(`actions.${actionKey}`) ? t(`actions.${actionKey}`) : shown.action;

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge variant="info">
          <SparklesIcon aria-hidden />
          {t("badge")}
        </Badge>
        <h3 className="min-w-0 truncate text-sm font-medium">{title}</h3>
      </div>
      <List>
        {shown.fields.map((field, index) => (
          <ListItem key={`${field.key}-${index}`} className="items-baseline justify-between gap-3 py-2">
            <span className="shrink-0 text-xs text-muted-foreground">{field.label ?? (t.has(`fields.${field.key}`) ? t(`fields.${field.key}`) : field.key)}</span>
            {field.href ? (
              <Link href={field.href} className="min-w-0 text-right break-words text-link hover:underline">
                {value(field)}
              </Link>
            ) : (
              <span className="min-w-0 text-right break-words whitespace-pre-line">{value(field)}</span>
            )}
          </ListItem>
        ))}
      </List>
      <p className="text-xs text-muted-foreground">{shown.notify.length > 0 ? t("notify", { names: shown.notify.join(", ") }) : t("notifyNone")}</p>

      {shown.state === "pending" || shown.state === "confirming" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending || shown.state === "confirming"} onClick={() => decide(confirmProposalAction)}>
            <CheckIcon aria-hidden />
            {t("confirm")}
          </Button>
          {shown.editHref ? <EditButton href={shown.editHref} label={t("edit")} /> : null}
          <Button type="button" variant="ghost" disabled={pending} onClick={() => decide(discardProposalAction)}>
            {t("discard")}
          </Button>
        </div>
      ) : null}

      {shown.state === "confirmed" ? (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="success">{t("states.confirmed")}</Badge>
          {shown.resultHref ? (
            <Link href={shown.resultHref} className="font-medium text-link hover:underline">
              {t("open")}
            </Link>
          ) : null}
        </p>
      ) : null}

      {shown.state === "discarded" ? <p className="text-xs text-muted-foreground">{t("states.discarded")}</p> : null}

      {shown.state === "expired" || shown.state === "failed" ? (
        <div className="flex flex-col gap-2 text-xs">
          <p className={shown.state === "failed" ? "text-destructive" : "text-muted-foreground"}>{shown.state === "failed" ? t("states.failed", { reason: errorText(shown.error ?? "generic") }) : t("states.expired")}</p>
          {shown.editHref ? <EditButton href={shown.editHref} label={t("edit")} small /> : null}
        </div>
      ) : null}

      {/* A refusal of the click itself (decided in another tab, the session gone) under a pending card. */}
      {shown.error && shown.state === "pending" ? <p className="text-xs text-destructive">{errorText(shown.error)}</p> : null}
    </section>
  );
}
