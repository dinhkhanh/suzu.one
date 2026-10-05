// The note editor's box, shared by the editor (note-editor-impl.tsx) and the stand-in shown while
// the editor's code is on its way (note-editor.tsx), so the one replaces the other without moving.
import { cn } from "cn";

export function noteEditorFrame(disabled: boolean | undefined, className: string | undefined): string {
  return cn(
    "rich-editor note-editor flex w-full min-w-0 flex-col rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
    disabled && "cursor-not-allowed bg-input/50 opacity-70 dark:bg-input/80",
    className,
  );
}

/** The height the text area opens at for `rows` lines; it grows with what is written. */
export const noteMinHeight = (rows: number) => `${rows * 1.7 + 1}em`;
