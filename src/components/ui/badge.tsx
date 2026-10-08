import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// The design's pill: 22px tall, fully rounded, the label in the tag's own colour on a tint of it,
// no border. `outline` and `secondary` are the plain ones for kinds and counts; `success`,
// `warning`, `info` and `destructive` name a state (pick them with `statusTone()` from ./tone so
// the same word is the same colour everywhere); the hues tell one category from another without
// meaning good or bad. `dot` puts a disc of the badge's colour in front of the label, so a column
// of statuses can be read without reading.
const badgeVariants = cva(
  "group/badge inline-flex h-[1.375rem] w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/35 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-ink text-ink-foreground [a]:hover:bg-ink/85",
        secondary: "bg-muted text-muted-foreground [a]:hover:bg-accent [a]:hover:text-foreground",
        outline: "border-border bg-background text-muted-foreground [a]:hover:bg-muted [a]:hover:text-foreground",
        destructive: "bg-destructive/10 text-destructive [a]:hover:bg-destructive/16 dark:bg-destructive/18",
        success: "bg-success/10 text-success [a]:hover:bg-success/16 dark:bg-success/18",
        warning: "bg-warning/12 text-warning [a]:hover:bg-warning/18 dark:bg-warning/18",
        info: "bg-info/10 text-info [a]:hover:bg-info/16 dark:bg-info/18",
        violet: "bg-tone-violet/10 text-tone-violet [a]:hover:bg-tone-violet/16 dark:bg-tone-violet/18",
        teal: "bg-tone-teal/12 text-tone-teal [a]:hover:bg-tone-teal/18 dark:bg-tone-teal/18",
        orange: "bg-tone-orange/12 text-tone-orange [a]:hover:bg-tone-orange/18 dark:bg-tone-orange/18",
        pink: "bg-tone-pink/10 text-tone-pink [a]:hover:bg-tone-pink/16 dark:bg-tone-pink/18",
        indigo: "bg-tone-indigo/10 text-tone-indigo [a]:hover:bg-tone-indigo/16 dark:bg-tone-indigo/18",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

function Badge({ className, variant = "default", dot = false, render, children, ...props }: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), dot && "pl-1.5", className),
        children: dot ? (
          <>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
            {children}
          </>
        ) : (
          children
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants, type BadgeVariant };
