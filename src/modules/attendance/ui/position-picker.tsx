"use client";
// A place on the map without typing a latitude (ATT-02): "use my position" asks the phone once;
// otherwise the person pastes what their map app copies — coordinates or the link. The numbers can
// still be typed, behind the fold. The form posts `latitude` and `longitude` as before.
// No map library: the project has none, and a link to the map shows where the point fell.
import { ChevronDownIcon, LocateFixedIcon, MapPinIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMapPoint, roundCoordinate } from "../engine/map-link";
import { readPosition } from "./geolocation";

/** A reading less precise than this is shown with a warning: a fence drawn from it would be in the wrong street. */
const IMPRECISE_M = 100;

type Value = { latitude: number | string | null | undefined; longitude: number | string | null | undefined };
const asText = (value: number | string | null | undefined) => (value === null || value === undefined ? "" : String(value));

export function PositionPicker({ label, defaultValue }: { label: string; defaultValue?: Value }) {
  const t = useTranslations("attendance.position");
  const [latitude, setLatitude] = useState(asText(defaultValue?.latitude));
  const [longitude, setLongitude] = useState(asText(defaultValue?.longitude));
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [locating, startLocating] = useTransition();
  const id = useId();
  const point = latitude && longitude && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180 ? { latitude: Number(latitude), longitude: Number(longitude) } : null;

  const set = (next: { latitude: number; longitude: number }, accuracy: number | null) => {
    setLatitude(String(roundCoordinate(next.latitude)));
    setLongitude(String(roundCoordinate(next.longitude)));
    setAccuracyM(accuracy === null ? null : Math.round(accuracy));
    setProblem(null);
  };

  const typed = (setter: (value: string) => void, value: string) => {
    setter(value.trim().replace(",", "."));
    setAccuracyM(null);
  };

  const locate = () =>
    startLocating(async () => {
      const { position, problem } = await readPosition();
      if (position) set(position, position.accuracyM);
      else setProblem(problem ?? "unavailable");
    });

  const paste = (text: string) => {
    setPasted(text);
    if (!text.trim()) return setProblem(null);
    const found = parseMapPoint(text);
    if (found) set(found, null);
    else setProblem("pasteInvalid");
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {/* What the form posts, whichever way the point was chosen. */}
      <input type="hidden" name="latitude" value={latitude} />
      <input type="hidden" name="longitude" value={longitude} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={locate} disabled={locating}>
          <LocateFixedIcon data-icon="inline-start" aria-hidden />
          {locating ? t("locating") : t("useMine")}
        </Button>
        {point ? (
          <>
            <a href={`https://www.google.com/maps?q=${point.latitude},${point.longitude}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-sm tabular-nums underline-offset-4 hover:underline">
              <MapPinIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">
                {point.latitude}, {point.longitude}
              </span>
            </a>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setLatitude("");
                setLongitude("");
                setAccuracyM(null);
                setPasted("");
              }}
            >
              {t("clear")}
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{t("none")}</span>
        )}
      </div>
      {point && accuracyM !== null ? <p className="text-xs text-muted-foreground">{accuracyM > IMPRECISE_M ? t("imprecise", { metres: accuracyM }) : t("accuracy", { metres: accuracyM })}</p> : null}
      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`problems.${problem}` as "problems.denied")}
        </p>
      ) : null}

      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t("byHand")}
          <ChevronDownIcon className="size-4 transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 pt-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-paste`}>{t("paste")}</Label>
              <Input id={`${id}-paste`} value={pasted} onChange={(event) => paste(event.target.value)} placeholder="10.771595, 106.704758" autoComplete="off" />
              <p className="text-xs text-muted-foreground">{t("pasteHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-latitude`}>{t("latitude")}</Label>
                <Input id={`${id}-latitude`} inputMode="decimal" value={latitude} onChange={(event) => typed(setLatitude, event.target.value)} placeholder="10.7716" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-longitude`}>{t("longitude")}</Label>
                <Input id={`${id}-longitude`} inputMode="decimal" value={longitude} onChange={(event) => typed(setLongitude, event.target.value)} placeholder="106.7048" />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
