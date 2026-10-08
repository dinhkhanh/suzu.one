"use client";

import * as React from "react";
import { cn } from "cn";

// What the shadcn controls that stand in for native form fields (Select, DatePicker) share: they
// submit through a hidden input, sit in a row like the native field did, and go back to their
// default when the form is reset.

const LAYOUT = /^-?(w-|min-w-|max-w-|flex-|basis-|grow|shrink|self-|order-|col-|row-|m[trblxyse]?-)/;

/**
 * Splits a caller's classes between the wrapper (how the field sits in its row: width, flex, margin)
 * and the control (how it looks: height, text size). The wrapper is `relative` because the hidden
 * form input is absolutely positioned, and the browser's "please fill in" bubble points at it.
 */
export function splitClasses(className: string | undefined) {
  const layout: string[] = [];
  const look: string[] = [];
  for (const token of className?.split(/\s+/).filter(Boolean) ?? []) (LAYOUT.test(token.slice(token.lastIndexOf(":") + 1)) ? layout : look).push(token);
  return { wrapper: cn("relative inline-flex w-full min-w-0 align-middle", layout), control: look.join(" ") };
}

/** Calls `reset` when the form that owns `input` is reset, as it would put a native field back to its default. */
export function useFormReset(input: React.RefObject<HTMLInputElement | null>, reset: (() => void) | null) {
  const latest = React.useRef(reset);
  React.useEffect(() => {
    latest.current = reset;
  });
  const active = reset !== null;
  React.useEffect(() => {
    const owner = input.current?.form;
    if (!owner || !active) return;
    const onReset = () => latest.current?.();
    owner.addEventListener("reset", onReset);
    return () => owner.removeEventListener("reset", onReset);
  }, [input, active]);
}
