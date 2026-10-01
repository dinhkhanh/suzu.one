import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The controls of the design: 40px tall under a thumb, 36px under a mouse, 10px corners, a
// 14px medium label and a 16px icon; every one gives under the finger (`press`). The variants are
// told apart without hovering: `default` is the ink key (black on paper, white at night) for the
// action a page is for, `accent` is the one blue key for the single hero action of a screen
// (check out, send the request), `outline` is a white key with a hairline, `secondary` a wash,
// `ghost` a bare label, and `destructive` a crimson tint that never fills.
const variants = cva(
  "press group/button inline-flex shrink-0 items-center justify-center rounded-[0.625rem] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
  {
    variants: {
      variant: {
        default:
          "bg-ink text-ink-foreground hover:bg-[color-mix(in_oklch,var(--ink),var(--background)_14%)] [&_svg:not([class*='text-'])]:text-ink-foreground",
        accent:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),black_10%)] [&_svg:not([class*='text-'])]:text-primary-foreground",
        outline:
          "border-border bg-background text-foreground hover:bg-muted aria-expanded:bg-muted dark:bg-input/20 [&_svg:not([class*='text-'])]:text-foreground/70",
        secondary:
          "bg-muted text-foreground hover:bg-accent aria-expanded:bg-accent [&_svg:not([class*='text-'])]:text-foreground/70",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted [&_svg:not([class*='text-'])]:text-foreground/70",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/16 focus-visible:ring-destructive/25 dark:bg-destructive/15 dark:hover:bg-destructive/25 [&_svg:not([class*='text-'])]:text-destructive",
        link: "text-link underline-offset-4 hover:underline [&_svg:not([class*='text-'])]:text-link",
      },
      size: {
        default:
          "h-10 gap-2 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 md:h-9 md:px-3",
        xs: "h-7 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 md:h-6 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-lg px-2.5 text-[0.8125rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 md:h-8 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 rounded-xl px-4 text-[0.9375rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 md:h-10 md:rounded-[0.625rem] md:px-3.5 md:text-sm",
        icon: "size-10 md:size-9",
        "icon-xs":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg md:size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-lg in-data-[slot=button-group]:rounded-lg md:size-8",
        "icon-lg": "size-11 md:size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// `cva` concatenates; `cn` merges — so `border-border` beats the base `border-transparent` on an
// outline link styled with `buttonVariants()` alone, the same as it does through <Button>.
const buttonVariants: typeof variants = (props) => cn(variants(props))

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
