import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The reference's tag: a 6px-cornered chip with a hairline border, the label in the tag's own
// colour on an almost-white tint. `outline` is the plain one; the colours name a state.
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/35 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/85",
        secondary: "bg-muted text-muted-foreground [a]:hover:bg-accent",
        destructive:
          "border-destructive/25 bg-destructive/8 text-destructive [a]:hover:bg-destructive/15 dark:bg-destructive/15",
        outline:
          "border-border bg-background text-foreground/80 [a]:hover:bg-muted [a]:hover:text-foreground",
        info: "border-primary/30 bg-primary/8 text-primary dark:bg-primary/15",
        success:
          "border-emerald-600/25 bg-emerald-600/8 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-300",
        warning:
          "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/12 dark:text-amber-300",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
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

export { Badge, badgeVariants }
