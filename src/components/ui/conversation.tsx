"use client";

// A chat thread that keeps to its newest message — AI Elements' Conversation (Vercel's shadcn
// registry), on `use-stick-to-bottom`. A new message or a growing answer brings the end into view
// while the reader is there; once they scroll up to read, it stays where they are, and a button
// takes them back. When the frame itself shrinks — a phone's keyboard coming up — a reader at the
// end stays at the end.

import * as React from "react";
import { ArrowDownIcon } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

function Conversation({ className, ...props }: React.ComponentProps<typeof StickToBottom>) {
  return <StickToBottom data-slot="conversation" className={cn("relative flex min-h-0 flex-1 flex-col overflow-y-hidden", className)} initial="instant" resize="smooth" role="log" {...props} />;
}

function ConversationContent({ className, scrollClassName, children, ...props }: Omit<React.ComponentProps<typeof StickToBottom.Content>, "children"> & { children: React.ReactNode }) {
  return (
    // The thread scrolls by itself: reaching its end does not drag the page under the sheet along.
    <StickToBottom.Content data-slot="conversation-content" scrollClassName={cn("overscroll-contain", scrollClassName)} className={cn("flex flex-col gap-5", className)} {...props}>
      <KeepToEnd />
      {children}
    </StickToBottom.Content>
  );
}

/** The frame shrank (a keyboard came up): a reader who was at the end is kept there. */
function KeepToEnd() {
  const { scrollRef, isAtBottom, scrollToBottom } = useStickToBottomContext();
  const atEnd = React.useRef(isAtBottom);
  React.useEffect(() => {
    atEnd.current = isAtBottom;
  }, [isAtBottom]);
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (atEnd.current) void scrollToBottom("instant");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef, scrollToBottom]);
  return null;
}

/** Back to the newest message, shown only when the reader has scrolled away from it. */
function ConversationScrollButton({ className, label, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={cn("absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background shadow-(--float-shadow) animate-fade", className)}
      onClick={() => void scrollToBottom()}
      {...props}
    >
      <ArrowDownIcon />
    </Button>
  );
}

export { Conversation, ConversationContent, ConversationScrollButton };
export { useStickToBottomContext as useConversation } from "use-stick-to-bottom";
