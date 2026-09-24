"use client";
// The first-sign-in guide (see ../welcome.ts). A modal of steps; "open this page" follows the link
// and folds the guide into a pill in the corner, which the layout keeps across navigation. Only
// "Finish" closes it for good — "Later" closes it until the next sign-in.
import { BookOpen, CalendarDays, ListChecks, MapPin, NotebookPen, PartyPopper, Receipt, Sparkles, Sun, UserRound, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WelcomeStep, WelcomeStepKey } from "../welcome";
import { completeWelcomeAction, postponeWelcomeAction } from "../welcome-actions";

const ICONS: Record<WelcomeStepKey, LucideIcon> = {
  welcome: Sparkles,
  today: Sun,
  checkIn: MapPin,
  me: UserRound,
  leave: CalendarDays,
  tasks: ListChecks,
  daily: NotebookPen,
  payslips: Receipt,
  kb: BookOpen,
  finish: PartyPopper,
};

// Where the reader is in the guide, for this tab, so a reload lands on the same step. Read with
// `useSyncExternalStore` like the sidebar's fold (components/shell/sidebar-store.ts): the server
// renders the first step, the client corrects it on hydration. Without storage the guide simply
// starts at the top.
const PLACE_KEY = "suzu.welcome.place";
type Place = { index: number; folded: boolean };
const START: Place = { index: 0, folded: false };
const listeners = new Set<() => void>();
let cached: Place | null = null;

function subscribePlace(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readPlace(): Place {
  if (cached === null) {
    try {
      const raw = window.sessionStorage.getItem(PLACE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Place>) : null;
      cached = { index: typeof parsed?.index === "number" ? parsed.index : 0, folded: parsed?.folded === true };
    } catch {
      cached = START;
    }
  }
  return cached;
}

const readPlaceOnServer = () => START;

function writePlace(next: Place | null) {
  cached = next ?? START;
  try {
    if (next) window.sessionStorage.setItem(PLACE_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(PLACE_KEY);
  } catch {
    // Storage blocked: the guide still works, it just forgets the step on reload.
  }
  for (const listener of listeners) listener();
}

export function WelcomeGuide({ steps, name }: { steps: WelcomeStep[]; name: string }) {
  const t = useTranslations("welcome");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const place = useSyncExternalStore(subscribePlace, readPlace, readPlaceOnServer);
  const index = Math.min(Math.max(place.index, 0), steps.length - 1);
  const folded = place.folded;
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const setIndex = (next: number) => writePlace({ index: next, folded });
  const setFolded = (next: boolean) => writePlace({ index, folded: next });

  const open = !closed && !folded;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  if (closed) return null;

  const step = steps[index];
  const Icon = ICONS[step.key];
  const last = index === steps.length - 1;
  const title = (key: WelcomeStepKey) => t(`steps.${key}.title`, { name });

  function later() {
    setClosed(true);
    writePlace(null);
    void postponeWelcomeAction();
  }

  function finish() {
    setFailed(false);
    startTransition(async () => {
      const result = await completeWelcomeAction({});
      if (!result.ok) return setFailed(true);
      writePlace(null);
      setClosed(true);
    });
  }

  function visit(href: string) {
    setFolded(true);
    router.push(href);
  }

  return (
    <>
      <dialog
        ref={dialog}
        aria-labelledby="welcome-title"
        aria-describedby="welcome-body"
        // Escape folds the guide rather than dismissing it: nothing is lost by a stray key.
        onCancel={(event) => {
          event.preventDefault();
          setFolded(true);
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-[0_24px_60px_-20px_oklch(0_0_0/35%)] backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t("label")} · {t("stepOf", { current: index + 1, total: steps.length })}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label={t("fold")} onClick={() => setFolded(true)}>
              <X />
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="size-5 text-primary" aria-hidden />
            </span>
            <h2 id="welcome-title" className="text-lg font-semibold">
              {title(step.key)}
            </h2>
            <p id="welcome-body" className="text-sm leading-relaxed text-foreground/85">
              {t(`steps.${step.key}.body`)}
            </p>
            <p className="rounded-lg bg-muted px-3 py-2 text-[0.8125rem] leading-relaxed text-muted-foreground">{t(`steps.${step.key}.tip`)}</p>
            {step.href ? (
              <Button variant="outline" size="sm" className="self-start" onClick={() => visit(step.href!)}>
                {t("visit")}
              </Button>
            ) : null}
          </div>

          <ol className="flex gap-1.5" aria-hidden>
            {steps.map((item, position) => (
              <li key={item.key} className={cn("h-1.5 flex-1 rounded-full bg-muted", position <= index && "bg-primary")} />
            ))}
          </ol>

          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t("failed")}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={later} disabled={pending}>
              {t("later")}
            </Button>
            <div className="flex gap-2">
              {index > 0 ? (
                <Button variant="outline" onClick={() => setIndex(index - 1)} disabled={pending}>
                  {t("back")}
                </Button>
              ) : null}
              {last ? (
                <Button onClick={finish} disabled={pending}>
                  {pending ? t("finishing") : t("finish")}
                </Button>
              ) : (
                <Button onClick={() => setIndex(index + 1)}>{index === 0 ? t("start") : t("next")}</Button>
              )}
            </div>
          </div>
        </div>
      </dialog>

      {folded ? (
        <button
          type="button"
          onClick={() => setFolded(false)}
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-[0_12px_30px_-12px_oklch(0_0_0/35%)] hover:bg-muted"
        >
          <Sparkles className="size-4 text-primary" aria-hidden />
          {t("resume", { current: index + 1, total: steps.length })}
        </button>
      ) : null}
    </>
  );
}
