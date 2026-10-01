"use client"

import * as React from "react"
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { enUS, vi } from "react-day-picker/locale"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { splitClasses, useFormReset } from "@/components/ui/form-control"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { todayInVietnam } from "@/lib/dates"

// shadcn date pickers (Popover + Calendar) that read like the native inputs they replace:
// `DatePicker` is <input type="date"> ("YYYY-MM-DD"), `DateTimePicker` is
// <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") and `MonthPicker` is <input type="month">
// ("YYYY-MM"). Each takes `name`, `form`, `value` or `defaultValue`, `min`/`max` in its own format,
// `required`, `disabled`, `readOnly`, and an `onChange` whose `event.target.value` is the new value,
// so the forms that post them and the actions that parse them are unchanged. The value is submitted
// through a hidden input that the browser still validates, and a form reset restores the default.

type PickerProps = {
  id?: string
  name?: string
  form?: string
  value?: string
  defaultValue?: string
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  /** Shown, submitted, but not changeable — a native read-only field. */
  readOnly?: boolean
  placeholder?: string
  className?: string
  title?: string
  "aria-label"?: string
}

const pad = (value: number) => String(value).padStart(2, "0")

/** "YYYY-MM-DD" (or its "YYYY-MM" / "YYYY-MM-DDTHH:mm" relatives) as a local Date; a day past the month's end is its last day. */
function toDate(value: string | undefined): Date | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/)
  if (!match) return undefined
  const [year, month, day = 1] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 1)]
  if (month < 1 || month > 12 || day < 1) return undefined
  return new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate()))
}

const toIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const toIsoMonth = (year: number, month: number) => `${year}-${pad(month + 1)}`

/** The value a native field would hold: `value` when controlled, otherwise its own, reset with its form. */
function useFieldValue({ name, value, defaultValue, onChange }: Pick<PickerProps, "name" | "value" | "defaultValue" | "onChange">) {
  const [initial] = React.useState(defaultValue ?? "")
  const [inner, setInner] = React.useState(initial)
  const controlled = value !== undefined
  const current = controlled ? value : inner
  const hidden = React.useRef<HTMLInputElement | null>(null)
  useFormReset(hidden, controlled ? null : () => setInner(initial))

  const set = (next: string) => {
    if (next === current) return
    if (!controlled) setInner(next)
    const target = { value: next, name: name ?? "" }
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLInputElement>)
  }
  return { current, set, hidden }
}

/** Submits the value and carries `required`: the browser's "please fill in" bubble points at it, and focusing it focuses the trigger. */
function HiddenInput({ inputRef, trigger, value, name, form, required, disabled }: { inputRef: React.Ref<HTMLInputElement>; trigger: React.RefObject<HTMLButtonElement | null>; value: string; name?: string; form?: string; required?: boolean; disabled?: boolean }) {
  return (
    <input
      ref={inputRef}
      name={name}
      form={form}
      value={value}
      required={required}
      disabled={disabled}
      onChange={() => {}}
      onFocus={() => trigger.current?.focus()}
      tabIndex={-1}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
    />
  )
}

const TRIGGER =
  "flex h-10 w-full min-w-0 items-center gap-2 rounded-[0.625rem] border border-input bg-background px-2.5 py-1 text-left text-base whitespace-nowrap transition-[border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 data-[popup-open]:border-ring md:h-9 md:text-sm dark:bg-input/20 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"

function TriggerLabel({ text, placeholder }: { text: string | null; placeholder: string }) {
  return (
    <>
      <CalendarIcon />
      <span className={cn("truncate", !text && "text-faint")}>{text ?? placeholder}</span>
    </>
  )
}

function Footer({ onToday, todayLabel, onClear }: { onToday: (() => void) | null; todayLabel: string; onClear: (() => void) | null }) {
  const t = useTranslations("controls")
  if (!onToday && !onClear) return null
  return (
    <div className="flex items-center justify-between gap-2 border-t px-2 pt-2">
      <Button type="button" variant="ghost" size="sm" onClick={onToday ?? undefined} disabled={!onToday}>
        {todayLabel}
      </Button>
      {onClear ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {t("clear")}
        </Button>
      ) : null}
    </div>
  )
}

type CalendarPopoverProps = {
  id?: string
  date: string
  onDate: (date: string) => void
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  title?: string
  "aria-label"?: string
  trigger: React.RefObject<HTMLButtonElement | null>
  className?: string
}

/** The shadcn date picker itself: a button showing the date, opening a Calendar. */
function CalendarPopover({ id, date, onDate, min, max, required, disabled, placeholder, title, "aria-label": ariaLabel, trigger, className }: CalendarPopoverProps) {
  const t = useTranslations("controls")
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)

  const selected = toDate(date)
  const first = toDate(min)
  const last = toDate(max)
  const today = toDate(todayInVietnam())!
  const inRange = (day: Date) => (!first || day >= first) && (!last || day <= last)
  const text = selected ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(selected) : null

  const choose = (next: string) => {
    onDate(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger ref={trigger} id={id} title={title} aria-label={ariaLabel} disabled={disabled} className={cn(TRIGGER, className)}>
        <TriggerLabel text={text} placeholder={placeholder ?? t("pickDate")} />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 pb-2" align="start">
        <Calendar
          mode="single"
          required={required}
          selected={selected}
          onSelect={(day: Date | undefined) => choose(day ? toIsoDate(day) : "")}
          defaultMonth={selected ?? (inRange(today) ? today : (first ?? last))}
          today={today}
          captionLayout="dropdown"
          startMonth={first ?? new Date(1940, 0)}
          endMonth={last ?? new Date(today.getFullYear() + 10, 11)}
          disabled={[...(first ? [{ before: first }] : []), ...(last ? [{ after: last }] : [])]}
          locale={locale === "vi" ? vi : enUS}
        />
        <Footer todayLabel={t("today")} onToday={inRange(today) ? () => choose(toIsoDate(today)) : null} onClear={!required && date ? () => choose("") : null} />
      </PopoverContent>
    </Popover>
  )
}

/** <input type="date">: the value is "YYYY-MM-DD", or "" when no day is picked. */
function DatePicker({ id, name, form, value, defaultValue, onChange, min, max, required, disabled, readOnly, placeholder, className, title, "aria-label": ariaLabel }: PickerProps) {
  const { current, set, hidden } = useFieldValue({ name, value, defaultValue, onChange })
  const trigger = React.useRef<HTMLButtonElement | null>(null)
  const classes = splitClasses(className)
  return (
    <div className={classes.wrapper}>
      <CalendarPopover id={id} date={current} onDate={set} min={min} max={max} required={required} disabled={disabled || readOnly} placeholder={placeholder} title={title} aria-label={ariaLabel} trigger={trigger} className={classes.control} />
      <HiddenInput inputRef={hidden} trigger={trigger} value={current} name={name} form={form} required={required} disabled={disabled} />
    </div>
  )
}

/** <input type="datetime-local">: a date picker and a time field; the value is "YYYY-MM-DDTHH:mm", or "" without a date. */
function DateTimePicker({ id, name, form, value, defaultValue, onChange, min, max, required, disabled, readOnly, placeholder, className, title, "aria-label": ariaLabel }: PickerProps) {
  const t = useTranslations("controls")
  const { current, set, hidden } = useFieldValue({ name, value, defaultValue, onChange })
  const trigger = React.useRef<HTMLButtonElement | null>(null)
  // A time typed before any date is picked waits here until there is a date to join.
  const [pendingTime, setPendingTime] = React.useState("")
  const date = current.slice(0, 10)
  const time = current ? current.slice(11, 16) : pendingTime
  const classes = splitClasses(className)
  return (
    <div className={cn(classes.wrapper, "gap-2")}>
      <CalendarPopover id={id} date={date} onDate={(next) => set(next ? `${next}T${time || "00:00"}` : "")} min={min?.slice(0, 10)} max={max?.slice(0, 10)} required={required} disabled={disabled || readOnly} placeholder={placeholder} title={title} aria-label={ariaLabel} trigger={trigger} className={cn("flex-1", classes.control)} />
      <Input
        type="time"
        aria-label={t("time")}
        value={time}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => {
          setPendingTime(event.target.value)
          if (date) set(`${date}T${event.target.value || "00:00"}`)
        }}
        className={cn("w-28 shrink-0", classes.control)}
      />
      <HiddenInput inputRef={hidden} trigger={trigger} value={current} name={name} form={form} required={required} disabled={disabled} />
    </div>
  )
}

/** <input type="month">: a year with its twelve months; the value is "YYYY-MM", or "" when no month is picked. */
function MonthPicker({ id, name, form, value, defaultValue, onChange, min, max, required, disabled, readOnly, placeholder, className, title, "aria-label": ariaLabel }: PickerProps) {
  const t = useTranslations("controls")
  const locale = useLocale()
  const { current, set, hidden } = useFieldValue({ name, value, defaultValue, onChange })
  const trigger = React.useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = React.useState(false)

  const selected = toDate(current)
  const thisMonth = todayInVietnam().slice(0, 7)
  const [year, setYear] = React.useState(() => (selected ?? toDate(thisMonth)!).getFullYear())
  const first = min?.slice(0, 7)
  const last = max?.slice(0, 7)
  const inRange = (month: string) => (!first || month >= first) && (!last || month <= last)
  const text = selected ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(selected) : null
  const monthName = new Intl.DateTimeFormat(locale, { month: "short" })
  const classes = splitClasses(className)

  const onOpenChange = (next: boolean) => {
    if (next) setYear((selected ?? toDate(thisMonth)!).getFullYear())
    setOpen(next)
  }
  const choose = (next: string) => {
    set(next)
    setOpen(false)
  }

  return (
    <div className={classes.wrapper}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger ref={trigger} id={id} title={title} aria-label={ariaLabel} disabled={disabled || readOnly} className={cn(TRIGGER, classes.control)}>
          <TriggerLabel text={text} placeholder={placeholder ?? t("pickMonth")} />
        </PopoverTrigger>
        <PopoverContent className="w-64 gap-2 p-2" align="start">
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("previousYear")} onClick={() => setYear(year - 1)} disabled={!!first && `${year - 1}-12` < first}>
              <ChevronLeftIcon />
            </Button>
            <span className="text-sm font-medium">{year}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("nextYear")} onClick={() => setYear(year + 1)} disabled={!!last && `${year + 1}-01` > last}>
              <ChevronRightIcon />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, month) => {
              const iso = toIsoMonth(year, month)
              return (
                <Button key={iso} type="button" size="sm" variant={iso === current.slice(0, 7) ? "default" : iso === thisMonth ? "secondary" : "ghost"} disabled={!inRange(iso)} onClick={() => choose(iso)} className="font-normal">
                  {monthName.format(new Date(year, month, 1))}
                </Button>
              )
            })}
          </div>
          <Footer todayLabel={t("thisMonth")} onToday={inRange(thisMonth) ? () => choose(thisMonth) : null} onClear={!required && current ? () => choose("") : null} />
        </PopoverContent>
      </Popover>
      <HiddenInput inputRef={hidden} trigger={trigger} value={current} name={name} form={form} required={required} disabled={disabled} />
    </div>
  )
}

export { DatePicker, DateTimePicker, MonthPicker }
