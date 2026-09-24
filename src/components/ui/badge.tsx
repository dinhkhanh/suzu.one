import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The reference's tag: a 6px-cornered chip with a hairline border, the label in the tag's own
// colour on an almost-white tint. `outline` and `secondary` are the plain ones for kinds and
// counts; `success`, `warning`, `info` and `destructive` name a state (pick them with
// `statusTone()` from ./tone so the same word is the same colour everywhere); the hues tell one
// category from another without meaning good or bad. `dot` puts a disc of the badge's colour in
// front of the label, so a column of statuses can be read without reading.
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/35 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/85",
        secondary: "bg-muted text-foreground/75 [a]:hover:bg-accent",
        outline:
          "border-border bg-background text-foreground/80 [a]:hover:bg-muted [a]:hover:text-foreground",
        destructive:
          "border-destructive/25 bg-destructive/8 text-destructive [a]:hover:bg-destructive/15 dark:bg-destructive/15",
        success:
          "border-success/25 bg-success/8 text-success [a]:hover:bg-success/15 dark:bg-success/15",
        warning:
          "border-warning/30 bg-warning/10 text-warning [a]:hover:bg-warning/18 dark:bg-warning/15",
        info: "border-info/25 bg-info/8 text-info [a]:hover:bg-info/15 dark:bg-info/15",
        violet:
          "border-tone-violet/25 bg-tone-violet/8 text-tone-violet [a]:hover:bg-tone-violet/15 dark:bg-tone-violet/15",
        teal: "border-tone-teal/30 bg-tone-teal/10 text-tone-teal [a]:hover:bg-tone-teal/18 dark:bg-tone-teal/15",
        orange:
          "border-tone-orange/30 bg-tone-orange/10 text-tone-orange [a]:hover:bg-tone-orange/18 dark:bg-tone-orange/15",
        pink: "border-tone-pink/25 bg-tone-pink/8 text-tone-pink [a]:hover:bg-tone-pink/15 dark:bg-tone-pink/15",
        indigo:
          "border-tone-indigo/25 bg-tone-indigo/8 text-tone-indigo [a]:hover:bg-tone-indigo/15 dark:bg-tone-indigo/15",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

function Badge({
  className,
  variant = "default",
  dot = false,
  render,
  children,
  ...props
}: useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), dot && "pl-1.5", className),
        children: dot ? (
          <>
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-current opacity-80"
            />
            {children}
          </>
        ) : (
          children
        ),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants, type BadgeVariant }
