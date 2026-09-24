import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import {
  CircleAlert,
  CircleCheck,
  Info,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react"
import type * as React from "react"

// A notice in the flow of a page: a tinted box with an icon that says the tone before the text
// does. `warning` and `destructive` announce themselves to a screen reader; the others wait.
const alertVariants = cva(
  "flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm text-foreground [&_a]:underline [&_a]:underline-offset-2",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted/40",
        info: "border-info/30 bg-info/8 dark:bg-info/12",
        success: "border-success/30 bg-success/8 dark:bg-success/12",
        warning: "border-warning/35 bg-warning/10 dark:bg-warning/12",
        destructive: "border-destructive/30 bg-destructive/8 dark:bg-destructive/12",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
)

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>

const ICONS: Record<AlertVariant, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
}

const ICON_COLOUR: Record<AlertVariant, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
}

function Alert({
  className,
  variant = "neutral",
  icon,
  role,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: AlertVariant
  /** Replace the tone's icon, or `null` for none. */
  icon?: LucideIcon | null
}) {
  const Icon = icon === undefined ? ICONS[variant] : icon
  return (
    <div
      data-slot="alert"
      role={
        role ?? (variant === "warning" || variant === "destructive" ? "alert" : "status")
      }
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {Icon ? (
        <Icon
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0", ICON_COLOUR[variant])}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {children}
      </div>
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="alert-title"
      className={cn("w-full font-medium", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, alertVariants, type AlertVariant }
