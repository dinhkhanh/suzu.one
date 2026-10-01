// The anatomy of a task row (the state dot, the key, the project chip, the due date, the avatar)
// lives with the tasks engine, so platform lists (My tasks' checklist steps, obligations) can wear
// it too; the work module reaches it from here.
export { ACCENT_SQUARE, ColorSquare, DueText, dotOf, dueTone, PersonAvatar, ProjectChip, StateDot, TaskKey, type DotCategory } from "@/modules/platform/tasks-engine/ui/task-row";
