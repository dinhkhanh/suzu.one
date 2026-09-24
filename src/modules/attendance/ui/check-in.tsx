"use client";
// The check-in screen's moving parts: one big button that asks the phone where it is and sends the
// punch, the answer in words, the install hint, and the reviewer's accept / reject form.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { punchAction, reviewPunchAction } from "../checkin-actions";

type PunchOutcome = { at: string; direction: "in" | "out"; outcome: "accepted" | "flagged"; flags: string[]; locationName: string | null; distanceM: number | null; duplicate: boolean };
type PositionReading = { latitude: number; longitude: number; accuracyM: number };

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

export function CheckInPanel({ nextDirection, punchExpected }: { nextDirection: "in" | "out"; /** false on untracked days, rest days and holidays: the button is there, but smaller words explain it is not needed. */ punchExpected: boolean }) {
  const t = useTranslations("attendance.checkIn");
  const format = useFormatter();
  const router = useRouter();
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

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={punch}
        disabled={pending}
        className={`flex size-48 flex-col items-center justify-center rounded-full text-xl font-semibold shadow-lg transition active:scale-95 disabled:opacity-60 ${nextDirection === "in" ? "bg-primary text-primary-foreground" : "bg-foreground text-background"}`}
      >
        {stage === "locating" ? t("locating") : stage === "sending" ? t("sending") : t(nextDirection === "in" ? "checkIn" : "checkOut")}
      </button>
      {punchExpected ? null : <p className="text-center text-sm text-muted-foreground">{t("notExpected")}</p>}
      <label className="flex w-full max-w-sm flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("note")}</span>
        <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={t("notePlaceholder")} />
      </label>

      <div aria-live="polite" className="w-full max-w-sm text-center text-sm">
        {result ? (
          <div className={`rounded-xl border p-3 ${result.outcome === "flagged" ? "border-amber-500/50 bg-amber-500/10" : "border-emerald-500/50 bg-emerald-500/10"}`}>
            <p className="font-medium">
              {t(result.direction === "in" ? "doneIn" : "doneOut", { time: format.dateTime(new Date(result.at), { hour: "2-digit", minute: "2-digit" }) })}
              {result.locationName ? ` · ${result.locationName}` : ""}
            </p>
            {result.duplicate ? <p className="text-muted-foreground">{t("duplicate")}</p> : null}
            {result.outcome === "flagged" ? (
              <>
                <p>{t("flagged")}</p>
                <ul className="text-muted-foreground">
                  {result.flags.map((flag) => (
                    <li key={flag}>{t(`flags.${flag}`, { distance: result.distanceM ?? 0 })}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
        {failure ? (
          <Alert variant="destructive">
            <AlertTitle>{t.has(`errors.${failure.key}`) ? t(`errors.${failure.key}`) : t("errors.generic")}</AlertTitle>
            <ul className="w-full">
              {failure.flags.map((flag) => (
                <li key={flag}>{t(`flags.${flag}`, { distance: 0 })}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>
    </div>
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
    <aside className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
      <span>{t(offer ? "offer" : mode === "ios" ? "ios" : "generic")}</span>
      {offer ? (
        <Button type="button" variant="outline" size="sm" onClick={() => offer.prompt().finally(() => setOffer(null))}>
          {t("button")}
        </Button>
      ) : null}
    </aside>
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
