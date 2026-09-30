"use client";
// Video and audio in the preview dialog: Video.js with its minimal skin (the successor of Plyr's
// look — a clean bar of play, time, volume, speed and fullscreen), tinted with the app's accent.
// Loaded on demand, so no page pays for a player until someone opens a clip.
import "@videojs/react/video/minimal-skin.css";
import "@videojs/react/audio/minimal-skin.css";
import { Audio, AudioPlayer, MinimalAudioSkin } from "@videojs/react/audio";
import { I18nProvider } from "@videojs/react/i18n";
import { MinimalVideoSkin, Video, VideoPlayer } from "@videojs/react/video";
import { useLocale } from "next-intl";
import { type CSSProperties, type SyntheticEvent, useRef } from "react";

const THEME = {
  "--media-accent-color": "var(--primary)",
  "--media-accent-text-color": "var(--primary-foreground)",
  "--media-border-radius": "var(--radius-lg)",
  "--media-font-family": "inherit",
} as CSSProperties;

/**
 * The link is short-lived: when it lapses mid-watch (a seek or a buffer after its minute), the
 * element errors, `onExpired` fetches a fresh one, and the clip picks up where the viewer was —
 * the moment, and whether it was playing — instead of starting over from 0:00.
 */
function useResume(onExpired: () => void) {
  const playing = useRef(false);
  const resume = useRef<{ time: number; play: boolean } | null>(null);
  return {
    onPlay: () => {
      playing.current = true;
    },
    onPause: () => {
      playing.current = false;
    },
    onError: (event: SyntheticEvent<HTMLMediaElement>) => {
      resume.current ??= { time: event.currentTarget.currentTime, play: playing.current };
      onExpired();
    },
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const at = resume.current;
      if (!at) return;
      resume.current = null;
      event.currentTarget.currentTime = at.time;
      if (at.play) void event.currentTarget.play().catch(() => undefined);
    },
  };
}

export default function MediaPlayer({ kind, url, onExpired }: { kind: "video" | "audio"; url: string; onExpired: () => void }) {
  const locale = useLocale();
  const handlers = useResume(onExpired);
  return (
    <I18nProvider locale={locale}>
      {kind === "video" ? (
        <VideoPlayer>
          <MinimalVideoSkin style={{ ...THEME, "--media-object-fit": "contain", width: "100%", maxHeight: "75vh", aspectRatio: "16 / 9", background: "black" } as CSSProperties}>
            <Video src={url} playsInline preload="metadata" autoPlay {...handlers} />
          </MinimalVideoSkin>
        </VideoPlayer>
      ) : (
        <AudioPlayer>
          <MinimalAudioSkin style={{ ...THEME, width: "100%" }}>
            <Audio src={url} preload="metadata" autoPlay {...handlers} />
          </MinimalAudioSkin>
        </AudioPlayer>
      )}
    </I18nProvider>
  );
}
