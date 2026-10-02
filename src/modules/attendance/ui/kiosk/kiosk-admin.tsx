"use client";
// The kiosk page's controls (FR-ATT-06): opening a kiosk on this tablet, closing one, enrolling a
// face, deleting one, and checking in with a kiosk's QR code from one's own phone.
import { Camera, ImageUp, ScanFace, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { closeKioskAction, deleteFacesAction, enrolFaceAction, kioskQrPunchAction, openKioskAction } from "../../kiosk-actions";
import { type FaceEngine, loadFaceEngine } from "./face-engine";

// The refusals each form explains; anything else is "something went wrong".
const KNOWN = ["forbidden", "face_consent_required", "face_photos_differ", "face_looks_like_someone_else", "kiosk_code_expired", "kiosk_not_yours", "models"];
const errorKey = (result: { ok: false; error: string; message?: string }) => {
  const key = result.error === "failed" ? (result.message ?? "generic") : result.error;
  return KNOWN.includes(key) ? key : "generic";
};

// ── Opening and closing ─────────────────────────────────────────────────────────────────────

/** Turns this browser into the clock's kiosk. Asks first: the person is signed out here in the same step. */
export function OpenKioskButton({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const t = useTranslations("attendance.kiosk");
  const errors = useTranslations("attendance.kiosk.errors");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ScanFace />
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("openTitle", { device: deviceName })}</DialogTitle>
            <DialogDescription>{t("openHint")}</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{errors(error as never)}</Alert> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="accent"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await openKioskAction({ deviceId });
                  if (!result.ok) return setError(errorKey(result));
                  // A full load, not a client navigation: this browser is no longer signed in, and the kiosk starts fresh.
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  window.location.assign("/kiosk");
                })
              }
            >
              {t("openConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CloseKioskButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations("attendance.kiosk");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await closeKioskAction({ sessionId });
          router.refresh();
        })
      }
    >
      <X />
      {t("close")}
    </Button>
  );
}

// ── Faces ───────────────────────────────────────────────────────────────────────────────────

type Shot = { id: number; preview: string; embedding: number[] };
type Problem = "no_face" | "several_faces" | "face_small" | "not_an_image";

/** A still picture's face, as the kiosk will see it. The picture stays in this browser; only the numbers are sent. */
async function readFace(engine: FaceEngine, source: HTMLCanvasElement | HTMLImageElement, width: number): Promise<{ embedding: number[] } | { problem: Problem }> {
  const found = engine.detect(source);
  if (!found) return { problem: "no_face" };
  if (found.count > 1) return { problem: "several_faces" };
  if (found.width * width < 90) return { problem: "face_small" };
  return { embedding: await engine.embed(source, found.points) };
}

function thumbnail(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  const side = 96;
  canvas.width = side;
  canvas.height = Math.round((height / width) * side);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/**
 * Enrolling a face: three to five photos from the camera, or uploaded. The consent box is asked for
 * the first time, and may be ticked again to record a newly signed form.
 */
export function EnrolFaceButton({ personId, personName, enrolled }: { personId: string; personName: string; enrolled: boolean }) {
  const t = useTranslations("attendance.kiosk.faces");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ScanFace />
        {enrolled ? t("addPhotos") : t("enrol")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">{open ? <EnrolForm personId={personId} personName={personName} enrolled={enrolled} onDone={() => setOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}

function EnrolForm({ personId, personName, enrolled, onDone }: { personId: string; personName: string; enrolled: boolean; onDone: () => void }) {
  const t = useTranslations("attendance.kiosk.faces");
  const errors = useTranslations("attendance.kiosk.errors");
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const engine = useRef<FaceEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const counter = useRef(0);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    loadFaceEngine("IMAGE")
      .then(async (loaded) => {
        if (stopped) return loaded.close();
        engine.current = loaded;
        setReady(true);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          if (stopped || !video.current) return;
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
        } catch {
          setCameraFailed(true);
        }
      })
      .catch(() => setError("models"));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
      engine.current?.close();
      engine.current = null;
    };
  }, []);

  const add = (embedding: number[], preview: string) => setShots((current) => [...current, { id: counter.current++, preview, embedding }].slice(-10));

  const capture = async () => {
    const element = video.current;
    if (!engine.current || !element || element.readyState < 2) return;
    setBusy(true);
    setProblem(null);
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")!.drawImage(element, 0, 0);
    const read = await readFace(engine.current, canvas, canvas.width);
    if ("problem" in read) setProblem(read.problem);
    else add(read.embedding, thumbnail(canvas, canvas.width, canvas.height));
    setBusy(false);
  };

  const upload = async (files: FileList | null) => {
    if (!files || !engine.current) return;
    setBusy(true);
    setProblem(null);
    for (const file of Array.from(files).slice(0, 10)) {
      const url = URL.createObjectURL(file);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const read = await readFace(engine.current, image, image.naturalWidth);
        if ("problem" in read) setProblem(read.problem);
        else add(read.embedding, thumbnail(image, image.naturalWidth, image.naturalHeight));
      } catch {
        setProblem("not_an_image");
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    setBusy(false);
  };

  const save = () =>
    start(async () => {
      setError(null);
      const result = await enrolFaceAction({ personId, embeddings: shots.map((shot) => shot.embedding), consent });
      if (!result.ok) return setError(errorKey(result));
      router.refresh();
      onDone();
    });

  const needsConsent = !enrolled && !consent;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title", { name: personName })}</DialogTitle>
        <DialogDescription>{t("hint")}</DialogDescription>
      </DialogHeader>
      <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-neutral-900">
        <video ref={video} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
        {!ready || cameraFailed ? <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/80">{cameraFailed ? t("noCamera") : t("loading")}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!ready || cameraFailed || busy} onClick={() => void capture()}>
          <Camera />
          {t("capture")}
        </Button>
        <Button type="button" variant="outline" disabled={!ready || busy} onClick={() => document.getElementById(`face-upload-${personId}`)?.click()}>
          <ImageUp />
          {t("upload")}
        </Button>
        <Input id={`face-upload-${personId}`} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(event) => void upload(event.currentTarget.files)} />
      </div>
      {problem ? <Alert variant="warning">{t(`problems.${problem}`)}</Alert> : null}
      {shots.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("photos", { count: shots.length })}>
          {shots.map((shot) => (
            <li key={shot.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made here, never uploaded */}
              <img src={shot.preview} alt="" className="h-16 w-12 rounded-[10px] object-cover" />
              <button type="button" aria-label={t("removePhoto")} className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-ink-foreground" onClick={() => setShots((current) => current.filter((item) => item.id !== shot.id))}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("count", { count: shots.length })}</p>
      <Label className="flex items-start gap-2.5 text-sm font-normal">
        <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} className="mt-0.5" />
        <span>{enrolled ? t("consentAgain") : t("consent")}</span>
      </Label>
      {error ? <Alert variant="destructive">{errors(error as never)}</Alert> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="button" disabled={pending || busy || shots.length === 0 || needsConsent} onClick={save}>
          {t("save", { count: shots.length })}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DeleteFacesButton({ personId, personName }: { personId: string; personName: string }) {
  const t = useTranslations("attendance.kiosk.faces");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label={t("delete")} title={t("delete")} onClick={() => setOpen(true)}>
        <Trash2 />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle", { name: personName })}</DialogTitle>
            <DialogDescription>{t("deleteHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await deleteFacesAction({ personId });
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Checking in with the kiosk's QR code ────────────────────────────────────────────────────

export function QrCheckIn({ token }: { token: string }) {
  const t = useTranslations("attendance.kiosk.scan");
  const errors = useTranslations("attendance.kiosk.errors");
  const format = useFormatter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ at: string; repeat: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
  if (done) return <Alert variant="success">{t(done.repeat ? "repeat" : "done", { time: time(done.at) })}</Alert>;
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert variant="destructive">{errors(error as never)}</Alert> : null}
      <Button
        variant="accent"
        size="lg"
        className="w-full md:w-auto"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await kioskQrPunchAction({ token });
            if (!result.ok) return setError(errorKey(result));
            setDone({ at: result.data.at, repeat: result.data.repeat });
          })
        }
      >
        {t("checkIn")}
      </Button>
    </div>
  );
}
