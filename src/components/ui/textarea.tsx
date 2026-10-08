import * as React from "react";
import { cn } from "cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-[0.625rem] border border-input bg-background px-3 py-2.5 text-base leading-relaxed transition-[border-color,box-shadow] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:min-h-16 md:text-sm dark:bg-input/20 dark:aria-invalid:border-destructive/50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
