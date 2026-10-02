// What the kiosk screen shows, frame by frame (FR-ATT-06). Pure: the clock and the dice are passed in.
//
//   idle ──a face──▶ looking ──the same person twice──▶ challenge ──turned the asked way──▶ punching ──▶ done
//                      │                                   │ timeout / wrong way / someone else
//                      └──nobody we know, 1.5 s──▶ unknown └────────────────────────────▶ failed
//
// The screen drives it. Each camera frame goes to `observe`, which says what it needs next: the
// face's numbers sent to the server to be named (`identify`), or compared with the face that was
// named (`track`). The answers come back through `identified`, `tracked` and `punched`. Done and
// failed stay on screen for a moment, whatever the camera sees. Someone who already punched a
// minute ago sees their earlier time again and makes no new punch. Every view that names a person
// says which way they are going (`way`): arriving is greeted, leaving is said goodbye to.
import { challengeVerdict, MATCH, MIN_TURN, type TurnDirection } from "./face";

export type KioskSettings = {
  keepThreshold: number;
  minTurn: number;
  /** Frames a face must be named the same before the challenge starts. */
  confirmFrames: number;
  /** Fraction of the frame's width a face must fill to be read. */
  minFaceWidth: number;
  challengeMs: number;
  doneMs: number;
  failedMs: number;
  unknownAfterMs: number;
};

export const KIOSK_SETTINGS: KioskSettings = { keepThreshold: MATCH.keepThreshold, minTurn: MIN_TURN, confirmFrames: 2, minFaceWidth: 0.16, challengeMs: 6000, doneMs: 4500, failedMs: 2500, unknownAfterMs: 1500 };

/** One frame's face: how wide (fraction of the frame), where the nose sits (`nosePosition`), and how many faces there are. */
export type FaceObservation = { width: number; position: number | null; count: number };

export type Way = "in" | "out";
/** Who the server named, whether their next punch arrives or leaves, and any punch of theirs a moment ago. */
export type Named = { personId: string; name: string; next: Way; recentAt: string | null; recentDirection: Way | null };
export type Punched = { punchId: string | null; at: string; name: string; repeat: boolean; direction: Way };

export type KioskView =
  | { state: "idle" | "closer" | "looking" | "unknown" | "crowd" }
  | { state: "challenge"; name: string; direction: TurnDirection; way: Way; secondsLeft: number }
  | { state: "punching"; name: string; way: Way }
  | { state: "done"; name: string; at: string; punchId: string | null; repeat: boolean; way: Way }
  | { state: "failed"; reason: "timeout" | "wrong_way" | "changed" | "error" | "cancelled" };

export type Need = "identify" | "track" | null;

type Mode =
  | { kind: "scanning"; candidate: string | null; frames: number; unknownSince: number | null }
  | { kind: "challenge"; person: Named; direction: TurnDirection; baseline: number; deadline: number }
  | { kind: "punching"; person: Named }
  | { kind: "held"; until: number; view: KioskView };

const scanning = (): Mode => ({ kind: "scanning", candidate: null, frames: 0, unknownSince: null });

export class KioskMachine {
  private mode: Mode = scanning();
  private last: KioskView = { state: "idle" };

  constructor(
    private readonly settings: KioskSettings = KIOSK_SETTINGS,
    private readonly random: () => number = Math.random,
  ) {}

  get view(): KioskView {
    return this.last;
  }

  /** The person being challenged or punched, whose face `track` compares against. */
  get person(): Named | null {
    return this.mode.kind === "challenge" || this.mode.kind === "punching" ? this.mode.person : null;
  }

  private show(view: KioskView, need: Need = null): { view: KioskView; need: Need } {
    this.last = view;
    return { view, need };
  }

  private hold(view: KioskView, ms: number, now: number): { view: KioskView; need: Need } {
    this.mode = { kind: "held", until: now + ms, view };
    return this.show(view);
  }

  private challengeView(now: number): KioskView {
    if (this.mode.kind !== "challenge") return this.last;
    return { state: "challenge", name: this.mode.person.name, direction: this.mode.direction, way: this.mode.person.next, secondsLeft: Math.max(0, Math.ceil((this.mode.deadline - now) / 1000)) };
  }

  /** One camera frame. `now` is a monotonic clock in milliseconds. */
  observe(face: FaceObservation | null, now: number): { view: KioskView; need: Need } {
    if (this.mode.kind === "held") {
      if (now < this.mode.until) return this.show(this.mode.view);
      this.mode = scanning();
    }
    if (this.mode.kind === "punching") return this.show(this.last);
    const usable = !!face && face.count === 1 && face.width >= this.settings.minFaceWidth;

    if (this.mode.kind === "challenge") {
      if (now > this.mode.deadline) return this.hold({ state: "failed", reason: "timeout" }, this.settings.failedMs, now);
      if (face && face.count > 1) return this.hold({ state: "failed", reason: "changed" }, this.settings.failedMs, now);
      // Turning can take the face out of the detector's view for a frame or two.
      return this.show(this.challengeView(now), usable ? "track" : null);
    }

    if (!face) {
      this.mode = scanning();
      return this.show({ state: "idle" });
    }
    if (face.count > 1) {
      this.mode = scanning();
      return this.show({ state: "crowd" });
    }
    if (!usable) {
      this.mode = scanning();
      return this.show({ state: "closer" });
    }
    const since = this.mode.kind === "scanning" ? this.mode.unknownSince : null;
    const unknown = since !== null && now - since >= this.settings.unknownAfterMs;
    return this.show({ state: unknown ? "unknown" : "looking" }, "identify");
  }

  /** The server's answer to `identify`, with the nose position of the frame that was sent. */
  identified(named: Named | null, position: number | null, now: number): KioskView {
    if (this.mode.kind !== "scanning") return this.last;
    if (!named) {
      this.mode = { kind: "scanning", candidate: null, frames: 0, unknownSince: this.mode.unknownSince ?? now };
      return this.show({ state: now - this.mode.unknownSince! >= this.settings.unknownAfterMs ? "unknown" : "looking" }).view;
    }
    const frames = named.personId === this.mode.candidate ? this.mode.frames + 1 : 1;
    this.mode = { kind: "scanning", candidate: named.personId, frames, unknownSince: null };
    if (frames < this.settings.confirmFrames) return this.show({ state: "looking" }).view;
    if (named.recentAt) return this.hold({ state: "done", name: named.name, at: named.recentAt, punchId: null, repeat: true, way: named.recentDirection ?? named.next }, this.settings.doneMs, now).view;
    if (position === null) return this.show({ state: "looking" }).view;
    const direction: TurnDirection = this.random() < 0.5 ? "left" : "right";
    this.mode = { kind: "challenge", person: named, direction, baseline: position, deadline: now + this.settings.challengeMs };
    return this.show(this.challengeView(now)).view;
  }

  /** During the challenge: how alike this frame's face is to the named one, and where its nose sits. */
  tracked(similarity: number, position: number | null, now: number): { view: KioskView; punch: Named | null } {
    if (this.mode.kind !== "challenge") return { view: this.last, punch: null };
    if (now > this.mode.deadline) return { view: this.hold({ state: "failed", reason: "timeout" }, this.settings.failedMs, now).view, punch: null };
    if (similarity < this.settings.keepThreshold) return { view: this.hold({ state: "failed", reason: "changed" }, this.settings.failedMs, now).view, punch: null };
    if (position === null) return { view: this.show(this.challengeView(now)).view, punch: null };
    const verdict = challengeVerdict(this.mode.direction, this.mode.baseline, position, this.settings.minTurn);
    if (verdict === "wrong_way") return { view: this.hold({ state: "failed", reason: "wrong_way" }, this.settings.failedMs, now).view, punch: null };
    if (verdict === "wait") return { view: this.show(this.challengeView(now)).view, punch: null };
    const person = this.mode.person;
    this.mode = { kind: "punching", person };
    return { view: this.show({ state: "punching", name: person.name, way: person.next }).view, punch: person };
  }

  /** The server's answer to the punch; null when it failed. */
  punched(result: Punched | null, now: number): KioskView {
    if (this.mode.kind !== "punching") return this.last;
    if (!result) return this.hold({ state: "failed", reason: "error" }, this.settings.failedMs, now).view;
    return this.hold({ state: "done", name: result.name, at: result.at, punchId: result.repeat ? null : result.punchId, repeat: result.repeat, way: result.direction }, this.settings.doneMs, now).view;
  }

  /** "Not me": the punch was taken back. */
  cancelled(now: number): KioskView {
    return this.hold({ state: "failed", reason: "cancelled" }, this.settings.failedMs + 500, now).view;
  }
}
