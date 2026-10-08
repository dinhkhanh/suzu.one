import { describe, expect, it } from "vitest";
import { type FaceObservation, KIOSK_SETTINGS, KioskMachine, type Named } from "./kiosk-machine";

const face = (position = 0.5, width = 0.3, count = 1): FaceObservation => ({ width, position, count });
const lan: Named = { personId: "lan", name: "Lan", next: "in", recentAt: null, recentDirection: null };

/** A machine whose dice always say "left", walked to the challenge at t = 0. */
function challenged() {
  const machine = new KioskMachine(KIOSK_SETTINGS, () => 0.1);
  expect(machine.observe(face(), 0).need).toBe("identify");
  expect(machine.identified(lan, 0.5, 100)).toEqual({ state: "looking" });
  expect(machine.identified(lan, 0.5, 200)).toEqual({ state: "challenge", name: "Lan", direction: "left", way: "in", secondsLeft: 6 });
  return machine;
}

describe("the kiosk screen", () => {
  it("rests when nobody is there, asks to come closer, and wants one face at a time", () => {
    const machine = new KioskMachine();
    expect(machine.observe(null, 0)).toEqual({ view: { state: "idle" }, need: null });
    expect(machine.observe(face(0.5, 0.05), 10)).toEqual({ view: { state: "closer" }, need: null });
    expect(machine.observe(face(0.5, 0.3, 2), 20)).toEqual({ view: { state: "crowd" }, need: null });
  });

  it("says it does not know a face only after a moment of not knowing it", () => {
    const machine = new KioskMachine();
    machine.observe(face(), 0);
    expect(machine.identified(null, 0.5, 0)).toEqual({ state: "looking" });
    expect(machine.identified(null, 0.5, 1000)).toEqual({ state: "looking" });
    expect(machine.identified(null, 0.5, 1600)).toEqual({ state: "unknown" });
    expect(machine.observe(face(), 1700).view).toEqual({ state: "unknown" });
  });

  it("starts over when the name changes between frames", () => {
    const machine = new KioskMachine(KIOSK_SETTINGS, () => 0.9);
    machine.identified(lan, 0.5, 0);
    expect(machine.identified({ personId: "huy", name: "Huy", next: "out", recentAt: null, recentDirection: null }, 0.5, 100)).toEqual({ state: "looking" });
    expect(machine.identified({ personId: "huy", name: "Huy", next: "out", recentAt: null, recentDirection: null }, 0.5, 200)).toMatchObject({ state: "challenge", direction: "right", way: "out" });
  });

  it("punches after the head turns the asked way, then holds the greeting", () => {
    const machine = challenged();
    expect(machine.observe(face(), 300).need).toBe("track");
    expect(machine.tracked(0.8, 0.55, 400)).toMatchObject({ view: { state: "challenge" }, punch: null });
    expect(machine.tracked(0.7, 0.66, 1500)).toEqual({ view: { state: "punching", name: "Lan", way: "in" }, punch: lan });
    expect(machine.observe(face(), 1600).need).toBeNull();
    expect(machine.punched({ punchId: "p1", at: "2026-10-02T08:42:00+07:00", name: "Lan", repeat: false, direction: "in" }, 1700)).toEqual({
      state: "done",
      name: "Lan",
      at: "2026-10-02T08:42:00+07:00",
      punchId: "p1",
      repeat: false,
      way: "in",
    });
    expect(machine.observe(null, 3000).view.state).toBe("done");
    expect(machine.observe(null, 1700 + KIOSK_SETTINGS.doneMs + 1).view).toEqual({ state: "idle" });
  });

  it("fails a turn the wrong way, a different face, a second face, and a slow turn", () => {
    expect(challenged().tracked(0.8, 0.3, 500).view).toEqual({ state: "failed", reason: "wrong_way" });
    expect(challenged().tracked(0.1, 0.66, 500).view).toEqual({ state: "failed", reason: "changed" });
    expect(challenged().observe(face(0.5, 0.3, 2), 500).view).toEqual({ state: "failed", reason: "changed" });
    expect(challenged().observe(face(), 7000).view).toEqual({ state: "failed", reason: "timeout" });
  });

  it("keeps the challenge through a frame without a usable face", () => {
    const machine = challenged();
    expect(machine.observe(null, 500)).toMatchObject({ view: { state: "challenge" }, need: null });
    expect(machine.tracked(0.8, null, 600).view).toMatchObject({ state: "challenge" });
  });

  it("shows the earlier time, and which way it went, to someone who punched a moment ago — without a challenge", () => {
    const machine = new KioskMachine();
    const left = { ...lan, next: "in" as const, recentAt: "2026-10-02T17:40:00+07:00", recentDirection: "out" as const };
    machine.identified(left, 0.5, 0);
    expect(machine.identified(left, 0.5, 100)).toEqual({ state: "done", name: "Lan", at: "2026-10-02T17:40:00+07:00", punchId: null, repeat: true, way: "out" });
  });

  it("answers a failed punch and a taken-back one", () => {
    const failed = challenged();
    failed.tracked(0.8, 0.7, 500);
    expect(failed.punched(null, 600)).toEqual({ state: "failed", reason: "error" });
    expect(challenged().cancelled(700)).toEqual({ state: "failed", reason: "cancelled" });
  });
});
