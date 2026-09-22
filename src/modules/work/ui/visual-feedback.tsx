"use client";
// Visual feedback (FR-PJM-52): tap a point of an image — or pause a video — to pin a comment to that
// version; the pins are numbered on the picture and listed below it. Two versions side by side
// compare an image with the one before, or play two cuts next to each other.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addPinAction, setPinResolvedAction } from "../delivery-actions";
import { formatTimecode, type MediaKind } from "../engine/delivery";
import { DeliveryError, errorKeyOf, type Result, useSignedUrl } from "./delivery-shared";

export type PinItem = { id: string; x: number | null; y: number | null; timecodeMs: number | null; body: string; authorName: string | null; resolved: boolean; createdAt: string; canResolve: boolean };
export type MediaVersion = { id: string; version: number; fileId: string; fileName: string; media: MediaKind };

type Draft = { x: number | null; y: number | null; timecodeMs: number | null };

/** One version's picture with its pins. */
export function PinBoard({ version, pins, canPin }: { version: MediaVersion; pins: PinItem[]; canPin: boolean }) {
  const t = useTranslations("work.pins");
  const format = useFormatter();
  const router = useRouter();
  const { url, failed, refresh } = useSignedUrl(version.fileId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);
  const shown = pins.filter((pin) => showResolved || !pin.resolved);
  const numberOf = (id: string) => pins.findIndex((pin) => pin.id === id) + 1;
  const run = (call: () => Promise<Result>, done?: () => void) =>
    startTransition(async () => {
      const result = await call();
      setErrorKey(errorKeyOf(result));
      if (result.ok) {
        done?.();
        router.refresh();
      }
    });

  const placeOnImage = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canPin) return;
    const box = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000));
    setDraft({ x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height), timecodeMs: null });
  };
  const seek = (pin: PinItem) => {
    setActive(pin.id);
    if (pin.timecodeMs !== null && video.current) {
      video.current.currentTime = pin.timecodeMs / 1000;
      video.current.pause();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {failed ? (
        <p className="text-sm text-muted-foreground">
          {t("unavailable")}{" "}
          <Button type="button" size="xs" variant="link" onClick={refresh}>
            {t("retry")}
          </Button>
        </p>
      ) : !url ? (
        <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" aria-label={t("loading")} />
      ) : version.media === "image" ? (
        <div className={`relative w-full select-none overflow-hidden rounded-lg border ${canPin ? "cursor-crosshair" : ""}`} onClick={placeOnImage} role={canPin ? "button" : undefined} aria-label={canPin ? t("tapToPin") : undefined}>
          {/* A signed, one-minute link: next/image would cache and resize it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={version.fileName} className="block h-auto w-full" draggable={false} onError={refresh} />
          {shown
            .filter((pin) => pin.x !== null && pin.y !== null)
            .map((pin) => (
              <button
                key={pin.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setActive(pin.id);
                }}
                style={{ left: `${pin.x! * 100}%`, top: `${pin.y! * 100}%` }}
                className={`absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold shadow ${pin.resolved ? "bg-muted-foreground text-white" : "bg-primary text-primary-foreground"} ${active === pin.id ? "ring-2 ring-ring" : ""}`}
                aria-label={t("pinNumber", { number: numberOf(pin.id) })}
              >
                {numberOf(pin.id)}
              </button>
            ))}
          {draft?.x !== null && draft?.x !== undefined ? <span style={{ left: `${draft.x * 100}%`, top: `${draft.y! * 100}%` }} className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-dashed border-primary bg-primary/30" /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <video ref={video} src={url} controls playsInline preload="metadata" className="w-full rounded-lg border bg-black" onError={refresh} onTimeUpdate={(event) => setPlayhead(Math.round(event.currentTarget.currentTime * 1000))} />
          {canPin ? (
            <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => {
                video.current?.pause();
                setDraft({ x: null, y: null, timecodeMs: playhead });
              }}
            >
              {t("pinHere", { time: formatTimecode(playhead) })}
            </Button>
          ) : null}
        </div>
      )}
      {canPin && url && version.media === "image" && !draft ? <p className="text-xs text-muted-foreground">{t("tapToPin")}</p> : null}

      {draft ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = String(new FormData(event.currentTarget).get("body") ?? "");
            run(() => addPinAction({ deliverableId: version.id, x: draft.x ?? "", y: draft.y ?? "", timecodeMs: draft.timecodeMs ?? "", body }), () => setDraft(null));
          }}
        >
          <span className="text-xs text-muted-foreground">{draft.timecodeMs !== null ? formatTimecode(draft.timecodeMs) : t("newPin")}</span>
          <Input name="body" required maxLength={2000} autoFocus placeholder={t("commentPlaceholder")} aria-label={t("comment")} className="min-w-0 flex-1" />
          <Button type="submit" size="sm" disabled={pending}>
            {t("save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
            {t("cancel")}
          </Button>
        </form>
      ) : null}
      <DeliveryError errorKey={errorKey} />

      {pins.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">{t("count", { open: pins.filter((pin) => !pin.resolved).length, total: pins.length })}</p>
            {pins.some((pin) => pin.resolved) ? (
              <Button type="button" size="xs" variant="ghost" onClick={() => setShowResolved(!showResolved)}>
                {showResolved ? t("hideResolved") : t("showResolved")}
              </Button>
            ) : null}
          </div>
          <ol className="flex flex-col divide-y rounded-lg border text-sm">
            {shown.map((pin) => (
              <li key={pin.id} className={`flex items-start gap-2 p-2 ${active === pin.id ? "bg-muted/60" : ""}`}>
                <button type="button" onClick={() => seek(pin)} className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${pin.resolved ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`} aria-label={t("pinNumber", { number: numberOf(pin.id) })}>
                  {numberOf(pin.id)}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={pin.resolved ? "text-muted-foreground line-through" : ""}>
                    {pin.timecodeMs !== null ? <span className="mr-1 font-mono text-xs">{formatTimecode(pin.timecodeMs)}</span> : null}
                    {pin.body}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pin.authorName ?? "—"} · {format.dateTime(new Date(pin.createdAt), { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
                {pin.canResolve ? (
                  <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setPinResolvedAction({ pinId: pin.id, resolved: !pin.resolved }))}>
                    {pin.resolved ? t("reopen") : t("resolve")}
                  </Button>
                ) : pin.resolved ? (
                  <Badge variant="outline">{t("resolved")}</Badge>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** Two versions side by side (stacked on a phone): pick any two of the task's images or videos. */
export function CompareVersions({ versions }: { versions: MediaVersion[] }) {
  const t = useTranslations("work.pins");
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(versions[1]?.id ?? "");
  const [right, setRight] = useState(versions[0]?.id ?? "");
  if (versions.length < 2) return null;
  const picker = (value: string, set: (id: string) => void, label: string) => (
    <Select aria-label={label} value={value} onChange={(event) => set(event.target.value)} className="w-28">
      {versions.map((version) => (
        <option key={version.id} value={version.id}>
          v{version.version}
        </option>
      ))}
    </Select>
  );
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setOpen(!open)}>
        {open ? t("closeCompare") : t("compare")}
      </Button>
      {open ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            {picker(left, setLeft, t("left"))} ↔ {picker(right, setRight, t("right"))}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {[left, right].map((id, index) => {
              const version = versions.find((row) => row.id === id);
              return version ? <CompareSide key={`${index}:${id}`} version={version} /> : null;
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompareSide({ version }: { version: MediaVersion }) {
  const t = useTranslations("work.pins");
  const { url, failed, refresh } = useSignedUrl(version.fileId);
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="font-mono text-xs text-muted-foreground">v{version.version}</figcaption>
      {failed ? (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      ) : !url ? (
        <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
      ) : version.media === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={version.fileName} className="h-auto w-full rounded-lg border" onError={refresh} />
      ) : (
        <video src={url} controls playsInline preload="metadata" className="w-full rounded-lg border bg-black" onError={refresh} />
      )}
    </figure>
  );
}
