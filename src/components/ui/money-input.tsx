"use client"

import * as React from "react"
import { useLocale } from "next-intl"
import { cn } from "cn"

import { useFormReset } from "@/components/ui/form-control"
import { Input } from "@/components/ui/input"
import { caretAfter, formatAmount, formatPlaceholder, readAmount, separatorsFor, type AmountOptions } from "@/lib/amount-text"

// An amount of money, grouped as it is typed in the reader's locale: "1.500.000" in Vietnamese,
// "1,500,000" in English, with that locale's decimal mark when `decimals` allows a fraction. The
// form gets the plain number ("1500000", "-1500000.5") through a hidden input under `name`, so the
// actions that parse it never see a separator. `value` / `defaultValue` take that plain number, and
// `onChange` hands it back as `event.target.value`. Money is whole đồng, so `decimals` defaults to 0.

type MoneyInputProps = Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "inputMode"> &
  AmountOptions & {
    value?: string | number | null
    defaultValue?: string | number | null
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  }

function MoneyInput({ name, form, value, defaultValue, onChange, onBlur, decimals = 0, allowNegative = false, disabled, placeholder, className, ref, ...props }: MoneyInputProps) {
  const separators = separatorsFor(useLocale())
  const options = { decimals, allowNegative }
  const plain = (input: string | number | null | undefined) => readAmount(formatAmount(input, separators, options), separators, options).raw
  const shown = (raw: string) => ({ raw, display: formatAmount(raw, separators, options) })

  const controlled = value !== undefined
  const [initial] = React.useState(() => plain(defaultValue))
  const [state, setState] = React.useState(() => shown(controlled ? plain(value) : initial))
  // A controlled value changed from outside: show it.
  if (controlled && plain(value) !== state.raw) setState(shown(plain(value)))

  const visible = React.useRef<HTMLInputElement | null>(null)
  useFormReset(visible, controlled ? null : () => setState(shown(initial)))

  // Regrouping rewrites the text, so the caret is put back after the digit it followed.
  const caret = React.useRef<number | null>(null)
  React.useLayoutEffect(() => {
    const input = visible.current
    const at = caret.current
    caret.current = null
    if (input && at !== null && document.activeElement === input) input.setSelectionRange(at, at)
  })

  const setRefs = (node: HTMLInputElement | null) => {
    visible.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  return (
    <>
      <Input
        {...props}
        ref={setRefs}
        type="text"
        inputMode={allowNegative ? "text" : decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        disabled={disabled}
        placeholder={formatPlaceholder(placeholder, separators)}
        value={state.display}
        className={cn("tabular-nums", className)}
        onChange={(event) => {
          const typed = event.target.value
          const next = readAmount(typed, separators, options)
          caret.current = caretAfter(typed, event.target.selectionStart ?? typed.length, next.display, separators, options)
          setState(next)
          if (next.raw === state.raw) return
          const target = { value: next.raw, name: name ?? "" }
          onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLInputElement>)
        }}
        onBlur={(event) => {
          // A decimal mark typed with nothing after it goes once the field is left.
          const tidy = shown(state.raw)
          if (tidy.display !== state.display) setState(tidy)
          onBlur?.(event)
        }}
      />
      {name ? <input type="hidden" name={name} form={form} value={state.raw} disabled={disabled} /> : null}
    </>
  )
}

export { MoneyInput }
