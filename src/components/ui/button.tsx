import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The reference's controls: 36px tall, 10px corners, 14px medium label and a 16px icon. Each
// variant is told from the others without hovering: the primary action is filled blue, `outline`
// is a white key with a visible border and a lift, `secondary` is washed in the accent, and
// `ghost` is a bare dark label.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[0.625rem] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_oklch(0_0_0/16%),inset_0_1px_0_oklch(1_0_0/16%)] hover:bg-[color-mix(in_oklch,var(--primary),black_10%)] [&_svg:not([class*='text-'])]:text-primary-foreground",
        outline:
          "border-input bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0/6%)] hover:border-foreground/25 hover:bg-muted aria-expanded:bg-muted dark:bg-input/30 [&_svg:not([class*='text-'])]:text-foreground/70",
        secondary:
          "bg-primary/10 text-link hover:bg-primary/18 aria-expanded:bg-primary/18 dark:bg-primary/20 [&_svg:not([class*='text-'])]:text-link",
        ghost:
          "text-foreground hover:bg-accent aria-expanded:bg-accent [&_svg:not([class*='text-'])]:text-foreground/70",
        destructive:
          "border-destructive/20 bg-destructive/8 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/25 dark:bg-destructive/15 dark:hover:bg-destructive/25 [&_svg:not([class*='text-'])]:text-destructive",
        link: "text-link underline-offset-4 hover:underline [&_svg:not([class*='text-'])]:text-link",
      },
      size: {
        default:
          "h-9 gap-2 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-2.5 text-[0.8125rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
