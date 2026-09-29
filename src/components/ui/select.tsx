"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { SearchIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "cn"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { InputGroupAddon } from "@/components/ui/input-group"
import { toSearchKey } from "@/lib/text"

// A Combobox that reads like a native <select>: the same `<option>` / `<optgroup>` children, `name`
// for the form, `value` or `defaultValue`, and an `onChange` whose `event.target.value` is the
// chosen option's value. A short list opens from a button, a long one is typed into to filter it.
// Filtering ignores Vietnamese diacritics, so "nguyen" finds "Nguyễn". `MultiSelect` is the
// `<select multiple>`: chips, one form value per chip.

/** Above this many options the field itself is the search box; at or below, a button opens the list. */
const SEARCH_THRESHOLD = 8

type Option = { key: string; value: string; label: string; disabled: boolean }
type Group = { value: string; label: string | null; items: Option[] }

type SelectProps = {
  id?: string
  name?: string
  form?: string
  value?: string | number
  defaultValue?: string | number
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void
  required?: boolean
  disabled?: boolean
  className?: string
  title?: string
  "aria-label"?: string
  children?: React.ReactNode
  /** Forces the field to be (or not be) a search box, whatever the number of options. */
  searchable?: boolean
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

/** The options as a native <select> would see them: fragments flattened, `<optgroup>`s kept in order. */
function readOptions(children: React.ReactNode): Group[] {
  const groups: Group[] = []
  let loose: Group | null = null
  const option = (props: { value?: unknown; disabled?: boolean; children?: React.ReactNode }, index: number): Option => {
    const label = textOf(props.children)
    const value = props.value === undefined ? label : String(props.value)
    return { key: `${index}:${value}`, value, label, disabled: !!props.disabled }
  }
  let index = 0
  const walk = (nodes: React.ReactNode, into: Group | null) => {
    React.Children.forEach(nodes, (node) => {
      if (!React.isValidElement<{ value?: unknown; disabled?: boolean; label?: string; children?: React.ReactNode }>(node)) return
      if (node.type === React.Fragment) return walk(node.props.children, into)
      if (node.type === "optgroup") {
        const group: Group = { value: `group-${groups.length}`, label: node.props.label ?? null, items: [] }
        groups.push(group)
        loose = null
        return walk(node.props.children, group)
      }
      if (node.type !== "option") return
      const target = into ?? (loose ??= groups[groups.push({ value: `group-${groups.length}`, label: null, items: [] }) - 1])
      target.items.push(option(node.props, index++))
    })
  }
  walk(children, null)
  return groups.filter((group) => group.items.length > 0)
}

const matches = (item: Option, query: string) => toSearchKey(item.label).includes(toSearchKey(query))
const sameOption = (a: Option, b: Option) => a.value === b.value

const LAYOUT = /^-?(w-|min-w-|max-w-|flex-|basis-|grow|shrink|self-|order-|col-|row-|m[trblxyse]?-)/

/**
 * Splits a caller's classes between the wrapper (how the field sits in its row: width, flex, margin)
 * and the control (how it looks: height, text size). The wrapper is `relative` because Base UI's
 * hidden form input is absolutely positioned, and the browser's "please fill in" bubble points at it.
 */
function splitClasses(className: string | undefined) {
  const layout: string[] = []
  const look: string[] = []
  for (const token of className?.split(/\s+/).filter(Boolean) ?? []) (LAYOUT.test(token.slice(token.lastIndexOf(":") + 1)) ? layout : look).push(token)
  return { wrapper: cn("relative inline-flex w-full min-w-0 align-middle", layout), control: look.join(" ") }
}

/** The parsed options, kept as the same objects while they do not change, so the combobox keeps its highlight and scroll. */
function useOptions(children: React.ReactNode) {
  const parsed = readOptions(children)
  const signature = JSON.stringify(parsed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = React.useMemo(() => parsed, [signature])
  const options = React.useMemo(() => groups.flatMap((group) => group.items), [groups])
  const grouped = groups.some((group) => group.label !== null)
  return { items: grouped ? groups : options, options, grouped }
}

/** Calls `reset` when the form that owns `input` is reset, as it would put a native select back to its default. */
function useFormReset(input: React.RefObject<HTMLInputElement | null>, reset: (() => void) | null) {
  const latest = React.useRef(reset)
  React.useEffect(() => {
    latest.current = reset
  })
  const active = reset !== null
  React.useEffect(() => {
    const owner = input.current?.form
    if (!owner || !active) return
    const onReset = () => latest.current?.()
    owner.addEventListener("reset", onReset)
    return () => owner.removeEventListener("reset", onReset)
  }, [input, active])
}

function OptionList({ grouped }: { grouped: boolean }) {
  const t = useTranslations("controls")
  return (
    <>
      <ComboboxEmpty>{t("noResults")}</ComboboxEmpty>
      <ComboboxList>
        {grouped
          ? (group: Group) => (
              <ComboboxGroup key={group.value} items={group.items}>
                {group.label ? <ComboboxLabel>{group.label}</ComboboxLabel> : null}
                <ComboboxCollection>{renderItem}</ComboboxCollection>
              </ComboboxGroup>
            )
          : renderItem}
      </ComboboxList>
    </>
  )
}

function Select({ id, name, form, value, defaultValue, onChange, required, disabled, className, title, "aria-label": ariaLabel, children, searchable }: SelectProps) {
  const t = useTranslations("controls")
  const { items, options, grouped } = useOptions(children)

  const [initial] = React.useState(defaultValue === undefined ? undefined : String(defaultValue))
  const [inner, setInner] = React.useState(initial)
  const controlled = value !== undefined
  const wanted = controlled ? String(value) : inner
  // As a native select does: a value no option carries shows (and submits) the first enabled option.
  const selected = options.find((option) => option.value === wanted) ?? options.find((option) => !option.disabled) ?? null

  const hidden = React.useRef<HTMLInputElement | null>(null)
  useFormReset(hidden, controlled ? null : () => setInner(initial))

  const choose = (next: Option | null) => {
    // A native select always holds an option: clearing the text only lands on an empty option if there is one.
    const option = next ?? options.find((candidate) => candidate.value === "") ?? null
    if (!option || option.value === selected?.value) return
    if (!controlled) setInner(option.value)
    const target = { value: option.value, name: name ?? "" }
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>)
  }

  const search = searchable ?? options.length > SEARCH_THRESHOLD
  // In the search box an empty option ("—", "All …") is the placeholder, not text to type after.
  const blank = options.find((option) => option.value === "")
  const classes = splitClasses(className)

  return (
    <div className={classes.wrapper}>
      <Combobox<Option>
        items={items}
        value={selected}
        onValueChange={choose}
        isItemEqualToValue={sameOption}
        itemToStringLabel={(item) => (search && item.value === "" ? "" : item.label)}
        itemToStringValue={(item) => item.value}
        filter={matches}
        autoHighlight
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        inputRef={hidden}
      >
        {search ? (
          <>
            <ComboboxInput
              id={id}
              title={title}
              aria-label={ariaLabel}
              placeholder={blank?.label || t("search")}
              disabled={disabled}
              // Typing replaces the chosen name rather than adding to it.
              onFocus={(event) => event.currentTarget.select()}
              className={cn("h-9 w-full", classes.control)}
            >
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
            </ComboboxInput>
            <ComboboxContent>
              <OptionList grouped={grouped} />
            </ComboboxContent>
          </>
        ) : (
          <>
            <ComboboxTrigger
              id={id}
              title={title}
              aria-label={ariaLabel}
              disabled={disabled}
              className={cn(
                "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-[0.625rem] border border-input bg-background px-2.5 py-1 text-left text-base font-medium whitespace-nowrap shadow-[0_1px_1px_oklch(0_0_0/3%)] transition-colors outline-none focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 md:text-sm dark:bg-input/20 *:data-[slot=combobox-value]:truncate",
                classes.control
              )}
            >
              <ComboboxValue />
            </ComboboxTrigger>
            <ComboboxContent>
              {/* Base UI wants an input in every combobox: here it is the keyboard's, and typing still filters. */}
              <ComboboxPrimitive.Input aria-label={ariaLabel ?? t("search")} className="sr-only" />
              <OptionList grouped={grouped} />
            </ComboboxContent>
          </>
        )}
      </Combobox>
    </div>
  )
}

function renderItem(item: Option) {
  return (
    <ComboboxItem key={item.key} value={item} disabled={item.disabled}>
      {item.label}
    </ComboboxItem>
  )
}

type MultiSelectProps = {
  id?: string
  name?: string
  form?: string
  defaultValue?: readonly string[]
  disabled?: boolean
  className?: string
  "aria-label"?: string
  children?: React.ReactNode
}

function MultiSelect({ id, name, form, defaultValue, disabled, className, "aria-label": ariaLabel, children }: MultiSelectProps) {
  const { items, options, grouped } = useOptions(children)
  const anchor = useComboboxAnchor()
  const [initial] = React.useState<readonly string[]>(defaultValue ?? [])
  const [values, setValues] = React.useState(initial)
  const selected = options.filter((option) => values.includes(option.value))

  const hidden = React.useRef<HTMLInputElement | null>(null)
  useFormReset(hidden, () => setValues(initial))
  const classes = splitClasses(className)

  return (
    <div className={classes.wrapper}>
      <Combobox<Option, true>
        multiple
        items={items}
        value={selected}
        onValueChange={(next) => setValues(next.map((option) => option.value))}
        isItemEqualToValue={sameOption}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
        filter={matches}
        autoHighlight
        name={name}
        form={form}
        disabled={disabled}
        inputRef={hidden}
      >
        <ComboboxChips ref={anchor} className={cn("min-h-9 rounded-[0.625rem] bg-background px-2 shadow-[0_1px_1px_oklch(0_0_0/3%)] focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/25 dark:bg-input/20", classes.control)}>
          <ComboboxValue>
            {(chosen: Option[]) => (
              <>
                {chosen.map((option) => (
                  <ComboboxChip key={option.key}>{option.label}</ComboboxChip>
                ))}
                <ComboboxChipsInput id={id} aria-label={ariaLabel} disabled={disabled} />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <OptionList grouped={grouped} />
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

export { MultiSelect, Select }
