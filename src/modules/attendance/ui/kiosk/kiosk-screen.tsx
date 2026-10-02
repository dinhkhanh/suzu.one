"use client";
// The kiosk on the wall (FR-ATT-06). The camera stays in the tablet: every frame is read here,
// the face's 128 numbers go to /api/kiosk/* to be named and punched, and the picture itself goes
// nowhere. What the screen shows is `KioskMachine`'s answer, frame by frame. The QR code in the
// corner is for whoever the kiosk does not know: they scan it with their own phone and check in there.
import { ArrowLeft, ArrowRight, Maximize2, Settings2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { cosine } from "../../engine/face";
import { KioskMachine, type KioskView, type Named, type Punched } from "../../engine/kiosk-machine";
import { type FaceEngine, loadFaceEngine } from "./face-engine";
import { QrCode } from "./kiosk-qr";

type Phase = "loading" | "ready" | "camera" | "failed" | "closed";

class KioskClosed extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (response.status === 401) throw new KioskClosed();
  if (!response.ok && response.status !== 409) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

const ZONE = "Asia/Ho_Chi_Minh";

export function KioskScreen({ deviceName }: { deviceName: string }) {
  const t = useTranslations("kiosk");
  const format = useFormatter();
  const video = useRef<HTMLVideoElement>(null);
  const machine = useRef(new KioskMachine());
  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<KioskView>({ state: "idle" });
  const [offline, setOffline] = useState(false);
  const [qr, setQr] = useState<{ path: string; size: number } | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  const closed = useCallback((error: unknown) => {
    if (error instanceof KioskClosed) setPhase("closed");
    else setOffline(true);
  }, []);

  // The clock on the wall.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // The QR code changes every 20 seconds; asking for it is also how the kiosk learns it was closed.
  useEffect(() => {
    if (phase === "closed") return;
    let stopped = false;
    const refresh = () =>
      call<{ url: string; qr: { path: string; size: number } }>("/api/kiosk/qr")
        .then((body) => {
          if (!stopped) {
            setQr(body.qr);
            setOffline(false);
          }
        })
        .catch(closed);
    void refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [phase, closed]);

  // The screen stays on.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const keepAwake = () => {
      if (document.visibilityState === "visible" && "wakeLock" in navigator) navigator.wakeLock.request("screen").then((sentinel) => (lock = sentinel), () => undefined);
    };
    keepAwake();
    document.addEventListener("visibilitychange", keepAwake);
    return () => {
      document.removeEventListener("visibilitychange", keepAwake);
      void lock?.release();
    };
  }, []);

  // The camera, the models, and the loop that reads a frame about ten times a second.
  useEffect(() => {
    let stopped = false;
    let engine: FaceEngine | null = null;
    let stream: MediaStream | null = null;
    let frame = 0;
    (async () => {
      try {
        engine = await loadFaceEngine("VIDEO");
      } catch {
        if (!stopped) setPhase("failed");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch {
        if (!stopped) setPhase("camera");
        return;
      }
      const element = video.current;
      // Unmounted while the camera was starting: let it go, or it stays on.
      if (stopped || !element) return stream.getTracks().forEach((track) => track.stop());
      element.srcObject = stream;
      await element.play().catch(() => undefined);
      setPhase("ready");

      const kiosk = machine.current;
      let busy = false;
      let lastRead = 0;
      // The face as it was when the kiosk named it: the challenge checks it is still the same one, and the punch sends it.
      let named: number[] | null = null;

      const loop = () => {
        if (stopped) return;
        frame = requestAnimationFrame(loop);
        const at = performance.now();
        if (element.readyState < 2 || at - lastRead < 90 || !engine) return;
        lastRead = at;
        const found = engine.detect(element, at);
        const step = kiosk.observe(found ? { width: found.width, position: found.position, count: found.count } : null, at);
        setView(step.view);
        if (!step.need || !found || busy) return;
        busy = true;
        const reader = engine;
        void (async () => {
          try {
            const embedding = await reader.embed(element, found.points);
            if (step.need === "identify") {
              const body = await call<{ person: Named | null }>("/api/kiosk/identify", { embedding });
              setOffline(false);
              const next = kiosk.identified(body.person, found.position, performance.now());
              if (next.state === "challenge") named = embedding;
              setView(next);
              return;
            }
            const { view: next, punch } = kiosk.tracked(named ? cosine(embedding, named) : 0, found.position, performance.now());
            setView(next);
            if (!punch || !named) return;
            try {
              const result = await call<Punched & { error?: string }>("/api/kiosk/punch", { personId: punch.personId, embedding: named });
              setView(kiosk.punched(result.error ? null : result, performance.now()));
            } catch (error) {
              setView(kiosk.punched(null, performance.now()));
              throw error;
            }
          } catch (error) {
            closed(error);
          } finally {
            busy = false;
          }
        })();
      };
      frame = requestAnimationFrame(loop);
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      engine?.close();
    };
  }, [closed]);

  const notMe = (punchId: string) => {
    void call<{ cancelled: boolean }>("/api/kiosk/undo", { punchId })
      .then((body) => {
        if (body.cancelled) setView(machine.current.cancelled(performance.now()));
      })
      .catch(closed);
  };

  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone: ZONE });

  if (phase === "closed") {
    return (
      <Shell>
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">{t("closed.title")}</h1>
          <p className="text-white/80">{t("closed.body")}</p>
          <a href="/attendance/kiosk" className="rounded-[0.625rem] border border-white/40 px-4 py-2.5 text-sm font-medium hover:bg-white/10">
            {t("closed.signIn")}
          </a>
        </div>
      </Shell>
    );
  }
  if (phase === "camera" || phase === "failed") {
    return (
      <Shell>
        <p className="max-w-md text-center text-lg text-white/90">{t(phase === "camera" ? "cameraError" : "loadError")}</p>
      </Shell>
    );
  }

  const [title, sub] = words(view, t, time);
  const tone = view.state === "challenge" || view.state === "punching" ? "border-warning" : view.state === "done" ? "border-success" : view.state === "failed" || view.state === "unknown" ? "border-destructive" : "border-white/55";

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white select-none">
      <video ref={video} autoPlay playsInline muted className="absolute inset-0 size-full -scale-x-100 object-cover" />
      {offline ? <div className="absolute inset-x-0 top-0 z-10 bg-destructive px-4 py-1.5 text-center text-sm text-white">{t("offline")}</div> : null}

      <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="[text-shadow:0_2px_12px_rgb(0_0_0/0.6)]">
          <div className="font-mono text-4xl font-semibold tabular-nums sm:text-6xl">{now ? format.dateTime(now, { hour: "2-digit", minute: "2-digit", timeZone: ZONE }) : "--:--"}</div>
          <div className="text-sm text-white/90 sm:text-lg">{now ? format.dateTime(now, { weekday: "long", day: "numeric", month: "long", timeZone: ZONE }) : ""}</div>
        </div>
        {qr ? (
          <figure className="flex w-28 flex-col items-center gap-1.5 rounded-[14px] bg-black/55 p-2 backdrop-blur sm:w-36">
            <QrCode path={qr.path} modules={qr.size} size={128} label={t("qr.label")} />
            <figcaption className="text-center text-[0.6875rem] leading-tight text-white/90 sm:text-xs">{t("qr.caption")}</figcaption>
          </figure>
        ) : null}
      </header>

      <div aria-hidden className={cn("absolute top-1/2 left-1/2 aspect-[3/4] w-[min(60vw,52vh)] -translate-x-1/2 -translate-y-[52%] rounded-[48%/40%] border-4 transition-colors duration-200", tone)} />

      <section aria-live="polite" className="absolute bottom-[6vh] left-1/2 w-[min(92vw,45rem)] -translate-x-1/2 rounded-[22px] bg-black/70 px-6 py-5 text-center backdrop-blur">
        {phase === "loading" ? (
          <p className="text-xl font-semibold sm:text-3xl">{t("loading")}</p>
        ) : (
          <>
            <p className="text-2xl font-semibold text-balance sm:text-4xl">{title}</p>
            {view.state === "challenge" ? (
              <div className="mt-2 flex justify-center text-warning">{view.direction === "left" ? <ArrowLeft className="size-16 animate-pulse sm:size-24" /> : <ArrowRight className="size-16 animate-pulse sm:size-24" />}</div>
            ) : sub ? (
              <p className="mt-1 text-base text-white/90 sm:text-2xl">{sub}</p>
            ) : null}
            {view.state === "done" && view.punchId ? (
              <Button variant="outline" size="lg" className="mt-4 border-white/50 bg-transparent text-white hover:bg-white/10" onClick={() => notMe(view.punchId!)}>
                {t("notMe")}
              </Button>
            ) : null}
          </>
        )}
      </section>

      <FullscreenButton />

      <footer className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-2 text-xs text-white/50">
        <span>{deviceName}</span>
        <a href="/attendance/kiosk" className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:text-white/80" aria-label={t("manage")}>
          <Settings2 className="size-3.5" />
        </a>
      </footer>
    </main>
  );
}

const FULLSCREEN_KEY = "suzu.kiosk.fullscreen";
type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };

const fullscreenNow = () => !!(document.fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement) || matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;

/**
 * Full screen, without the browser's bars. Browsers allow it only on a tap, and drop it on a reload,
 * so the choice is remembered on the tablet and the next tap anywhere takes the kiosk back to full
 * screen. A browser without the API (an iPhone's Safari) is told how to add the kiosk to the home
 * screen instead, which opens it without bars (the kiosk's web manifest asks for that).
 */
function FullscreenButton() {
  const t = useTranslations("kiosk");
  const [full, setFull] = useState(true);
  const [hint, setHint] = useState(false);

  const enter = useCallback(() => {
    const element = document.documentElement as FullscreenElement;
    try {
      localStorage.setItem(FULLSCREEN_KEY, "1");
    } catch {
      // Private mode: the choice is not remembered; the button stays.
    }
    if (element.requestFullscreen) void element.requestFullscreen({ navigationUI: "hide" }).catch(() => setHint(true));
    else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
    else setHint(true);
  }, []);

  useEffect(() => {
    const update = () => setFull(fullscreenNow());
    const reenter = () => {
      let wanted = false;
      try {
        wanted = localStorage.getItem(FULLSCREEN_KEY) === "1";
      } catch {
        wanted = false;
      }
      if (wanted && !fullscreenNow() && (document.fullscreenEnabled || (document as FullscreenDocument).webkitFullscreenEnabled)) enter();
    };
    const first = setTimeout(update, 0);
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    document.addEventListener("pointerdown", reenter);
    return () => {
      clearTimeout(first);
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
      document.removeEventListener("pointerdown", reenter);
    };
  }, [enter]);

  if (full && !hint) return null;
  return (
    <div className="absolute top-28 left-4 z-10 flex max-w-[min(70vw,26rem)] flex-col items-start gap-2 sm:top-40 sm:left-6">
      {hint ? (
        <div className="rounded-[14px] bg-black/80 p-3 text-sm text-white backdrop-blur">
          <p>{t("fullscreenHint")}</p>
          <button type="button" className="mt-2 text-white/70 underline underline-offset-4" onClick={() => setHint(false)}>
            {t("close")}
          </button>
        </div>
      ) : null}
      {full ? null : (
        <Button variant="outline" size="lg" className="border-white/40 bg-black/50 text-white backdrop-blur hover:bg-white/10 [&_svg]:text-white" onClick={enter}>
          <Maximize2 />
          {t("fullscreen")}
        </Button>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="fixed inset-0 grid place-items-center bg-neutral-950 p-6 text-white">{children}</main>;
}

function words(view: KioskView, t: ReturnType<typeof useTranslations<"kiosk">>, time: (iso: string) => string): [string, string | null] {
  switch (view.state) {
    case "challenge":
      return [t("challenge", { name: view.name, direction: view.direction, way: view.way }), null];
    case "punching":
      return [t("punching", { name: view.name, way: view.way }), null];
    case "done":
      return view.repeat ? [view.name, t("repeat", { time: time(view.at), way: view.way })] : [t("done", { name: view.name, way: view.way }), t("doneAt", { time: time(view.at), way: view.way })];
    case "failed":
      return [t(view.reason === "cancelled" ? "cancelled.title" : "failed.title"), t(`failed.${view.reason}`)];
    default:
      return [t(`${view.state}.title`), t(`${view.state}.sub`)];
  }
}
