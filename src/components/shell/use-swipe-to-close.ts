"use client";
import { type RefObject, useEffect } from "react";

/** A flick: fast enough (px per ms) to close however short the drag was. */
const FLICK = 0.11;
/** How far a finger travels before the drag is read as one, and which way it is going. */
const SLOP = 8;

/**
 * The phone's menu drawer goes back the way it came under the finger: dragged toward its edge it
 * follows, dragged the other way it gives a little and no more, and on release a flick or a drag
 * past a third of its width puts it away while anything less lets it settle back. Vertical drags
 * are left to the browser (the menu scrolls). Touch events rather than pointer events: a browser
 * may cancel the pointer as soon as a finger moves, but it keeps reporting the touch.
 */
export function useSwipeToClose(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !open) return;
    let start: { id: number; x: number; y: number; at: number } | null = null;
    let dragging = false;
    let offset = 0;

    const reset = () => {
      element.style.transition = "";
      element.style.transform = "";
    };
    const down = (event: TouchEvent) => {
      // One finger at a time: a second one landing mid-drag would make the drawer jump to it.
      if (start) return;
      const touch = event.changedTouches[0];
      start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: event.timeStamp };
      dragging = false;
      offset = 0;
    };
    const ours = (event: TouchEvent) => (start ? Array.from(event.changedTouches).find((touch) => touch.identifier === start!.id) : undefined);
    const move = (event: TouchEvent) => {
      const touch = ours(event);
      if (!start || !touch) return;
      const x = touch.clientX - start.x;
      const y = touch.clientY - start.y;
      if (!dragging) {
        if (Math.abs(y) > SLOP && Math.abs(y) > Math.abs(x)) start = null;
        if (!start || Math.abs(x) < SLOP) return;
        dragging = true;
        element.style.transition = "none";
      }
      // The drag is the drawer's now: the page under it does not scroll or go back a page.
      if (event.cancelable) event.preventDefault();
      offset = x < 0 ? x : Math.sqrt(x) * 2;
      element.style.transform = `translateX(${offset}px)`;
    };
    const up = (event: TouchEvent) => {
      const touch = ours(event);
      if (!start || !touch) return;
      const elapsed = Math.max(event.timeStamp - start.at, 1);
      start = null;
      if (!dragging) return;
      dragging = false;
      // A drag that ends over a link is not a tap on it.
      if (event.cancelable) event.preventDefault();
      // From where the finger left it, the drawer's own transition carries it home or away.
      reset();
      if (event.type === "touchend" && (offset < -element.offsetWidth / 3 || -offset / elapsed > FLICK)) close();
    };

    element.addEventListener("touchstart", down, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", up);
    element.addEventListener("touchcancel", up);
    return () => {
      element.removeEventListener("touchstart", down);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", up);
      element.removeEventListener("touchcancel", up);
      reset();
    };
  }, [ref, open, close]);
}
