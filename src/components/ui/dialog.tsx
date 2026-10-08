"use client"

import * as React from "react"
import { Drawer as DialogPrimitive } from "@base-ui/react/drawer"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

// A dialog is a sheet on a phone — it rises from the bottom edge, a handle across its top, sits on
// the thumb, and a swipe down puts it away — and a centred card on a desk. One component, so every
// form that opens over a page gets the phone treatment without asking for it. It is Base UI's
// Drawer (a Dialog with the gesture); on a desk the card ignores swipes, so a mouse dragging across
// it selects text as it always did.

/** Tailwind's `sm`: from here up the dialog is a card. */
const DESK = "(min-width: 40rem)"
const subscribeDesk = (change: () => void) => {
  const query = window.matchMedia(DESK)
  query.addEventListener("change", change)
  return () => query.removeEventListener("change", change)
}
const useDesk = () =>
  React.useSyncExternalStore(subscribeDesk, () => window.matchMedia(DESK).matches, () => false)

/**
 * A phone's keyboard is laid over the page, not taken out of it (iOS Safari, and Chrome by
 * default): what is left in view is the visual viewport. The dialog's frame is kept to it, so a
 * sheet stands on the keyboard and the field being typed in stays in sight. Without a keyboard the
 * two are the same and nothing moves.
 */
function fitToVisible(element: HTMLDivElement | null) {
  const visible = typeof window === "undefined" ? undefined : window.visualViewport
  if (!element || !visible) return
  const fit = () => {
    element.style.setProperty("--visible-top", `${visible.offsetTop}px`)
    element.style.setProperty("--visible-height", `${visible.height}px`)
  }
  fit()
  visible.addEventListener("resize", fit)
  visible.addEventListener("scroll", fit)
  return () => {
    visible.removeEventListener("resize", fit)
    visible.removeEventListener("scroll", fit)
  }
}

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root swipeDirection="down" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // The scrim thins as the sheet is pulled down, and goes at the speed the sheet was thrown.
        "fixed inset-0 isolate z-50 min-h-dvh bg-ink/30 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-[360ms] ease-(--ease-drawer) data-swiping:duration-0 data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*280ms)] supports-[-webkit-touch-callout:none]:absolute sm:duration-150 sm:ease-(--ease-settle) sm:data-ending-style:duration-100",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  keepMounted,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** Keeps what is inside alive while closed — a conversation in progress, say. */
  keepMounted?: boolean
}) {
  const desk = useDesk()
  return (
    <DialogPortal keepMounted={keepMounted}>
      <DialogOverlay />
      <DialogPrimitive.Viewport ref={fitToVisible} className="fixed inset-x-0 top-[var(--visible-top,0px)] z-50 flex h-[var(--visible-height,100dvh)] items-end justify-center sm:items-center sm:p-4">
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          data-base-ui-swipe-ignore={desk ? "" : undefined}
          className={cn(
            // The phone: a sheet along the bottom edge. It rises on the iOS sheet curve, follows the
            // finger while held, and leaves at the speed it was thrown — a flick is enough.
            "relative grid max-h-[calc(var(--visible-height,100dvh)-3rem)] w-full gap-4 overflow-y-auto overscroll-contain rounded-t-[22px] bg-popover px-4 pt-3 text-sm text-popover-foreground shadow-(--float-shadow) outline-none",
            "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[transform,scale,opacity] duration-[360ms] ease-(--ease-drawer) data-swiping:duration-0 data-swiping:select-none data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)] data-ending-style:duration-[calc(var(--drawer-swipe-strength,1)*280ms)]",
            "pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]",
            "before:mx-auto before:block before:h-1 before:w-9 before:rounded-full before:bg-input before:content-['']",
            // The desk: a card in the middle that settles in from a touch smaller, and leaves faster
            // than it came. Not anchored to anything, so it grows from its own centre.
            "sm:max-h-[calc(var(--visible-height,100dvh)-4rem)] sm:max-w-sm sm:rounded-2xl sm:p-5 sm:[transform:none] sm:duration-150 sm:ease-(--ease-settle) sm:before:hidden sm:data-starting-style:[transform:none] sm:data-starting-style:scale-95 sm:data-starting-style:opacity-0 sm:data-ending-style:[transform:none] sm:data-ending-style:scale-95 sm:data-ending-style:opacity-0 sm:data-ending-style:duration-100",
            className
          )}
          {...props}
        >
          {/* Lets a mouse select text inside without the drag being read as a swipe. */}
          <DialogPrimitive.Content className="contents">{children}</DialogPrimitive.Content>
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              render={
                <Button
                  variant="ghost"
                  className="absolute top-3 right-3"
                  size="icon-sm"
                />
              }
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:-mx-5 sm:-mb-5 sm:flex-row sm:justify-end sm:rounded-b-2xl sm:border-t sm:bg-muted/50 sm:p-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-[1.0625rem] leading-6 font-semibold tracking-[-0.01em]",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
