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
import { splitClasses, useFormReset } from "@/components/ui/form-control"
import { InputGroupAddon } from "@/components/ui/input-group"
import { toSearchKey } from "@/lib/text"

// A Combobox that reads like a native <select>: the same `<option>` / `<optgroup>` children, `name`
// for the form, `value` or `defaultValue`, and an `onChange` whose `event.target.value` is the
// chosen option's value. A short list opens from a button, a long one is typed into to filter it.
// Filtering ignores Vietnamese diacritics, so "nguyen" finds "Nguyễn". `MultiSelect` is the
// `<select multiple>`: chips, one form value per chip.

/** Above this many options the field itself is the search box; at or below, a button opens the list. */
const SEARCH_THRESHOLD = 8

type Option = { key: string; value: string; label: string; disabled: boolean; /** The entry that offers to add what was typed (a creatable MultiSelect). */ create?: boolean }
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

function OptionList({ grouped, creatable }: { grouped: boolean; creatable?: boolean }) {
  const t = useTranslations("controls")
  if (creatable)
    return (
      <>
        <ComboboxEmpty>{t("typeToAdd")}</ComboboxEmpty>
        <ComboboxList>
          {(item: Option) =>
            item.create ? (
              <ComboboxItem key={item.key} value={item}>
                {t("add", { name: item.label })}
              </ComboboxItem>
            ) : (
              renderItem(item)
            )
          }
        </ComboboxList>
      </>
    )
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
              className={cn("h-10 w-full md:h-9", classes.control)}
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
                "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[0.625rem] border border-input bg-background px-2.5 py-1 text-left text-base font-medium whitespace-nowrap transition-[border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 md:h-9 md:text-sm dark:bg-input/20 *:data-[slot=combobox-value]:truncate",
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
  /** Called with every chosen value whenever the choice changes, for a form that keeps its own state. */
  onValueChange?: (values: string[]) => void
  /**
   * Lets the person add an entry that is not among the options (skills, tags): what they typed is
   * offered as "Add …", and the value posted for it is the text itself — so give the options their
   * names as values, and let the server find or create each name. Flat lists only.
   */
  creatable?: boolean
  /** How an added entry is written, e.g. capitalised: the chip and the posted value show it that way at once. */
  formatNew?: (typed: string) => string
  children?: React.ReactNode
}

const typedOption = (text: string): Option => ({ key: `new:${text}`, value: text, label: text, disabled: false })

function MultiSelect({ id, name, form, defaultValue, disabled, className, "aria-label": ariaLabel, onValueChange, creatable, formatNew, children }: MultiSelectProps) {
  const { items, options, grouped } = useOptions(children)
  const anchor = useComboboxAnchor()
  const [initial] = React.useState<readonly string[]>(defaultValue ?? [])
  const [values, setValues] = React.useState(initial)
  // What this person added themselves — and, to begin with, any chosen value the options do not list.
  const [added, setAdded] = React.useState<Option[]>(() => (creatable ? initial.filter((value) => !options.some((option) => option.value === value)).map(typedOption) : []))
  const [query, setQuery] = React.useState("")
  const known = creatable ? [...options, ...added.filter((entry) => !options.some((option) => option.value === entry.value))] : options
  const selected = known.filter((option) => values.includes(option.value))
  const spaced = query.trim().replace(/\s+/g, " ")
  const typed = formatNew ? formatNew(spaced) : spaced
  // Offered only for a name nobody has yet: "social media" finds "Social Media" instead of doubling it.
  const offer = creatable && typed !== "" && !known.some((option) => toSearchKey(option.label) === toSearchKey(typed)) ? { ...typedOption(typed), key: `create:${typed}`, create: true } : null

  const hidden = React.useRef<HTMLInputElement | null>(null)
  const listOpen = React.useRef(false)
  useFormReset(hidden, () => setValues(initial))
  const classes = splitClasses(className)

  return (
    <div className={classes.wrapper}>
      <Combobox<Option, true>
        multiple
        items={creatable ? (offer ? [...known, offer] : known) : items}
        value={selected}
        onValueChange={(next) => {
          const fresh = next.filter((option) => option.create).map((option) => typedOption(option.value))
          if (fresh.length > 0) setAdded((current) => [...current, ...fresh])
          // Chosen: the field is ready for the next entry.
          if (creatable) setQuery("")
          const chosen = next.map((option) => option.value)
          setValues(chosen)
          onValueChange?.(chosen)
        }}
        {...(creatable ? { inputValue: query, onInputValueChange: (value: string) => setQuery(value) } : {})}
        onOpenChange={(next) => {
          listOpen.current = next
        }}
        isItemEqualToValue={sameOption}
        itemToStringLabel={(item) => item.label}
        itemToStringValue={(item) => item.value}
        filter={creatable ? (item, text) => !!item.create || matches(item, text) : matches}
        autoHighlight
        name={name}
        form={form}
        disabled={disabled}
        inputRef={hidden}
      >
        <ComboboxChips ref={anchor} className={cn("min-h-10 rounded-[0.625rem] bg-background px-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20 md:min-h-9 dark:bg-input/20", classes.control)}>
          <ComboboxValue>
            {(chosen: Option[]) => (
              <>
                {chosen.map((option) => (
                  <ComboboxChip key={option.key}>{option.label}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id={id}
                  aria-label={ariaLabel}
                  disabled={disabled}
                  // Escape closes the list. Pressed again it would empty the field — every entry the
                  // person has just typed in — so on a closed list it does nothing here.
                  onKeyDown={creatable ? (event) => event.key === "Escape" && !listOpen.current && event.preventBaseUIHandler() : undefined}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <OptionList grouped={grouped} creatable={creatable} />
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

export { MultiSelect, Select }
