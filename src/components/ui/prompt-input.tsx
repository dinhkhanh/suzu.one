"use client"

// The box a chat question is typed in — AI Elements' PromptInput (Vercel's shadcn registry), cut
// to what a question needs and built on our InputGroup:
//
//   - Enter sends, Shift+Enter breaks the line, and an Enter that only closes a word being composed
//     (Vietnamese Telex or VNI, Japanese…) does neither.
//   - 16px text on a phone, so iOS does not zoom the page in when the box is tapped.
//   - The keyboard's return key reads Send, and the box grows with the question up to a few lines.
//   - The send button turns into a spinner while the question is being answered.

import * as React from "react"
import { ArrowUpIcon, Loader2Icon } from "lucide-react"
import { cn } from "cn"

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"

function PromptInput({ className, ...props }: React.ComponentProps<"form">) {
  return <form data-slot="prompt-input" className={cn("min-w-0", className)} {...props} />
}

function PromptInputBody({ className, ...props }: React.ComponentProps<typeof InputGroup>) {
  // The send button is disabled while a question is answered; the box itself stays as it is.
  return <InputGroup className={cn("items-end rounded-[1.25rem] bg-background has-[>textarea]:h-auto has-disabled:bg-background has-disabled:opacity-100 dark:has-disabled:bg-input/20", className)} {...props} />
}

function PromptInputTextarea({ className, onKeyDown, ...props }: React.ComponentProps<"textarea">) {
  const [composing, setComposing] = React.useState(false)
  return (
    <InputGroupTextarea
      rows={1}
      enterKeyHint="send"
      className={cn("field-sizing-content max-h-40 min-h-11 self-center py-2.5 pl-4 text-base leading-6 md:min-h-12 md:text-sm", className)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey) return
        if (composing || event.nativeEvent.isComposing) return
        event.preventDefault()
        const form = event.currentTarget.form
        const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
        if (submit?.disabled) return
        form?.requestSubmit()
      }}
      {...props}
    />
  )
}

function PromptInputSubmit({ className, pending = false, label, ...props }: Omit<React.ComponentProps<typeof InputGroupButton>, "type" | "children"> & { pending?: boolean; label: string }) {
  return (
    <InputGroupAddon align="inline-end" className="self-end py-1.5 pr-1.5">
      <InputGroupButton
        type="submit"
        size="icon-sm"
        variant="default"
        aria-label={label}
        title={label}
        disabled={pending}
        aria-busy={pending || undefined}
        className={cn("size-8 rounded-full", className)}
        {...props}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />}
      </InputGroupButton>
    </InputGroupAddon>
  )
}

export { PromptInput, PromptInputBody, PromptInputTextarea, PromptInputSubmit }
