// One icon per feedback category. Plain module: shared by server and client components.
import { Bug, CircleHelp, Heart, Lightbulb, MessageSquare, type LucideIcon } from "lucide-react";
import type { FeedbackCategory } from "../enums";

export const CATEGORY_ICONS: Record<FeedbackCategory, LucideIcon> = { bug: Bug, idea: Lightbulb, question: CircleHelp, praise: Heart, other: MessageSquare };
