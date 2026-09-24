import type * as React from "react";
import { LOGO_PATH, LOGO_VIEW_BOX } from "./logo-path";

/**
 * The SuZu Group mark. It is filled with `currentColor`, so the place that renders it decides
 * its colour: `text-brand` for the identity red, `text-white` on a tinted tile, `text-foreground`
 * where it has to be quiet. Size it with a `size-*` class; the box is 262 × 308, a touch taller
 * than wide. Decorative by default — the name beside it carries the meaning — unless a `title`
 * is given, which then labels it.
 */
export function Logo({
  title,
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "viewBox" | "fill" | "children"> & { title?: string }) {
  return (
    <svg
      viewBox={LOGO_VIEW_BOX}
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={className}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d={LOGO_PATH} />
    </svg>
  );
}
