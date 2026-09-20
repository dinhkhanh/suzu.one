"use client";
import { type ReactNode, useState } from "react";

/**
 * On a phone the navigation would push every screen (the check-in button first of all) below the
 * fold, so it folds behind a "Menu" button there; from `md` up it is always open.
 */
export function CollapsibleNav({ label, header, children }: { label: string; header: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {header}
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="rounded-md border px-2.5 py-1 text-sm md:hidden">
          {label}
        </button>
      </div>
      {/* Any tap inside (a link) folds it again. */}
      <div onClick={() => setOpen(false)} className={`${open ? "flex" : "hidden"} flex-1 flex-col gap-4 md:flex`}>
        {children}
      </div>
    </>
  );
}
