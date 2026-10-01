"use client";
// The check-in screen's moving parts: the status card (the state in words, the clock, one big key
// that asks the phone where it is and sends the punch, the answer in words), the install hint, and
// the reviewer's accept / reject form.
import { MapPinIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { cn } from "cn";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { punchAction, reviewPunchAction } from "../checkin-actions";
import { hoursText } from "./day-plan";

type PunchOutcome = { at: string; direction: "in" | "out"; outcome: "accepted" | "flagged"; flags: string[]; locationName: string | null; distanceM: number | null; duplicate: boolean };
type PositionReading = { latitude: number; longitude: number; accuracyM: number };

const ZONE = "Asia/Ho_Chi_Minh";

// Ten seconds is as long as anyone waits at the door; without a fix the punch still goes through, flagged.
function readPosition(): Promise<{ position: PositionReading | null; problem: string | null }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ position: null, problem: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (reading) => resolve({ position: { latitude: reading.coords.latitude, longitude: reading.coords.longitude, accuracyM: reading.coords.accuracy }, problem: null }),
      (error) => resolve({ position: null, problem: error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

const deviceInfo = (positionProblem: string | null) => ({
  platform: navigator.platform ?? "",
  language: navigator.language,
  screen: `${window.screen.width}x${window.screen.height}`,
  standalone: window.matchMedia("(display-mode: standalone)").matches,
  online: navigator.onLine,
  ...(positionProblem ? { positionProblem } : {}),
});

const everySecond = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};
const secondsNow = () => Math.floor(Date.now() / 1000);
const noSnapshot = () => null;

/** The wall clock, once a second, from the moment the page is on screen (the server renders no time, so nothing mismatches at hydration). */
function useNow(): Date | null {
  const seconds = useSyncExternalStore(everySecond, secondsNow, noSnapshot);
  return seconds === null ? null : new Date(seconds * 1000);
}

export function CheckInPanel({
  nextDirection,
  punchExpected,
  sinceAt,
  lastLocationName,
  hasLocations,
  punchedToday,
}: {
  nextDirection: "in" | "out";
  /** false on untracked days, rest days and holidays: the button is there, but smaller words explain it is not needed. */
  punchExpected: boolean;
  /** When the open check-in was made (ISO), for the "in since" line. */
  sinceAt: string | null;
  /** Where the last punch of the day was accepted, for the location line. */
  lastLocationName: string | null;
  hasLocations: boolean;
  punchedToday: boolean;
}) {
  const t = useTranslations("attendance.checkIn");
  const format = useFormatter();
  const router = useRouter();
  const now = useNow();
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<"idle" | "locating" | "sending">("idle");
  const [result, setResult] = useState<PunchOutcome | null>(null);
  const [failure, setFailure] = useState<{ key: string; flags: string[] } | null>(null);
  const [note, setNote] = useState("");

  function punch() {
    setFailure(null);
    setResult(null);
    startTransition(async () => {
      setStage("locating");
      const { position, problem } = await readPosition();
      setStage("sending");
      const answer = await punchAction({ direction: nextDirection, position, deviceInfo: deviceInfo(problem), note });
      setStage("idle");
      if (answer.ok) {
        setResult(answer.data);
        setNote("");
        router.refresh();
        return;
      }
      const details = answer.details as { flags?: string[] } | undefined;
      setFailure({ key: (answer.error === "failed" ? answer.message : answer.error) ?? "generic", flags: details?.flags ?? [] });
    });
  }

  // Until the refresh lands, the answer just received is the truth.
  const checkedIn = result ? result.direction === "in" : nextDirection === "out";
  const since = result?.direction === "in" ? result.at : checkedIn ? sinceAt : null;
  const sinceDate = since ? new Date(since) : null;
  const elapsedMinutes = sinceDate && now ? Math.max(0, Math.floor((now.getTime() - sinceDate.getTime()) / 60_000)) : null;
  const locationLine = result?.locationName ?? lastLocationName ?? (hasLocations ? t("locationChecked") : t("noLocations"));
  const clock = (value: Date) => format.dateTime(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONE });
  const seconds = now ? format.dateTime(now, { second: "2-digit", timeZone: ZONE }).padStart(2, "0") : "--";
  const status = checkedIn ? "in" : result || punchedToday ? "out" : "none";

  return (
    <section data-slot="check-in-card" className={cn("flex flex-col items-center gap-5 rounded-[14px] border border-border bg-background px-5 py-6 text-center transition-shadow duration-200 ease-(--ease-settle)", checkedIn && "ring-8 ring-success/10")}>
      <Badge variant={checkedIn ? "success" : "secondary"} className="h-7 px-3 text-[0.8125rem]">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-current", checkedIn && "animate-pulse")} />
        {t(`status.${status}`)}
      </Badge>

      <div className="flex flex-col items-center gap-1.5">
        <p className="flex items-baseline font-mono text-[64px] leading-none font-medium tracking-[-0.03em] tabular-nums" aria-live="off">
          <span>{now ? clock(now) : "--:--"}</span>
          <span className="ml-1 text-2xl text-faint">{seconds}</span>
        </p>
        {sinceDate && elapsedMinutes !== null ? <p className="text-sm text-muted-foreground">{t("since", { time: clock(sinceDate), elapsed: hoursText(elapsedMinutes) })}</p> : null}
      </div>

      <Button type="button" variant={nextDirection === "in" ? "accent" : "default"} size="lg" className="w-full" onClick={punch} disabled={pending}>
        {stage === "locating" ? t("locating") : stage === "sending" ? t("sending") : t(nextDirection === "in" ? "checkIn" : "checkOut")}
      </Button>
      {punchExpected ? null : <p className="text-sm text-muted-foreground">{t("notExpected")}</p>}

      <p className="flex items-center justify-center gap-1.5 text-[0.8125rem] text-muted-foreground">
        <MapPinIcon aria-hidden className="size-3.5 shrink-0 text-faint" />
        <span>{locationLine}</span>
      </p>

      <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={t("notePlaceholder")} aria-label={t("note")} className="w-full" />

      <div aria-live="polite" className="flex w-full flex-col gap-2 text-left empty:hidden">
        {result ? (
          <Alert variant={result.outcome === "flagged" ? "warning" : "success"}>
            <div className="flex flex-col gap-1">
              <AlertTitle>
                {t(result.direction === "in" ? "doneIn" : "doneOut", { time: clock(new Date(result.at)) })}
                {result.locationName ? ` · ${result.locationName}` : ""}
              </AlertTitle>
              {result.duplicate ? <p>{t("duplicate")}</p> : null}
              {result.outcome === "flagged" ? (
                <>
                  <p>{t("flagged")}</p>
                  <ul className="list-disc pl-4">
                    {result.flags.map((flag) => (
                      <li key={flag}>{t(`flags.${flag}`, { distance: result.distanceM ?? 0 })}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </Alert>
        ) : null}
        {failure ? (
          <Alert variant="destructive">
            <div className="flex flex-col gap-1">
              <AlertTitle>{t.has(`errors.${failure.key}`) ? t(`errors.${failure.key}`) : t("errors.generic")}</AlertTitle>
              {failure.flags.length > 0 ? (
                <ul className="list-disc pl-4">
                  {failure.flags.map((flag) => (
                    <li key={flag}>{t(`flags.${flag}`, { distance: 0 })}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void> };

/** "Add to home screen": a button where the browser offers one (Chromium), words where it does not (iOS Safari), nothing once installed. */
export function InstallHint() {
  const t = useTranslations("attendance.checkIn.install");
  const [offer, setOffer] = useState<InstallEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "ios" | "generic">("hidden");

  useEffect(() => {
    const onOffer = (event: Event) => {
      event.preventDefault();
      setOffer(event as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onOffer);
    const frame = requestAnimationFrame(() => {
      if (window.matchMedia("(display-mode: standalone)").matches) return;
      setMode(/iPad|iPhone|iPod/.test(navigator.userAgent) ? "ios" : "generic");
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", onOffer);
      cancelAnimationFrame(frame);
    };
  }, []);

  if (mode === "hidden") return null;
  return (
    <Alert>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 text-muted-foreground">
        <span>{t(offer ? "offer" : mode === "ios" ? "ios" : "generic")}</span>
        {offer ? (
          <Button type="button" variant="outline" size="sm" onClick={() => offer.prompt().finally(() => setOffer(null))}>
            {t("button")}
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

export function ReviewPunchForm({ id }: { id: string }) {
  const t = useTranslations("attendance.review");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(reviewPunchAction, { extra: { id }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="note" maxLength={500} placeholder={t("note")} className="min-w-40 flex-1" aria-label={t("note")} />
        <Button type="submit" name="decision" value="accept" size="sm" disabled={pending}>
          {t("accept")}
        </Button>
        <Button type="submit" name="decision" value="reject" size="sm" variant="destructive" disabled={pending}>
          {t("reject")}
        </Button>
      </div>
      <FormError namespace="attendance.review.errors" errorKey={errorKey} />
    </form>
  );
}
