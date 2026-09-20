// Value lists shared by the server and the screens. A plain module on purpose: constants exported
// from a "use client" file are client references on the server.

/** FR-WRK-03: every workflow state of a team belongs to one of these. */
export const STATE_CATEGORIES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

/** The task engine's generic status (one `task` table for every kind of work, ADR-10). */
export const CATEGORY_STATUS: Record<StateCategory, "todo" | "in_progress" | "done" | "cancelled"> = {
  backlog: "todo",
  todo: "todo",
  in_progress: "in_progress",
  in_review: "in_progress",
  done: "done",
  cancelled: "cancelled",
};
export const isOpenCategory = (category: StateCategory): boolean => category !== "done" && category !== "cancelled";

export const VISIBILITIES = ["entity", "team", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const TEAM_ROLES = ["lead", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const PROJECT_STATUSES = ["planned", "active", "paused", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CLIENT_KINDS = ["client", "brand"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

/** 1 = urgent … 4 = low; null = no priority. */
export const PRIORITIES = [1, 2, 3, 4] as const;

export const CHANNELS = ["facebook", "tiktok", "youtube", "instagram", "zalo", "linkedin", "website", "offline", "other"] as const;
export const CONTENT_FORMATS = ["post", "short_video", "long_video", "story", "livestream", "article", "banner", "key_visual", "photo_album", "tvc", "other"] as const;

export const DEPENDENCY_TYPES = ["blocks", "relates"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const LABEL_COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;

/** Starter workflows a new team can take (FR-WRK-03); the team edits its states afterwards. */
export const WORKFLOW_PRESETS: Record<"simple" | "content", { key: string; category: StateCategory }[]> = {
  simple: [
    { key: "backlog", category: "backlog" },
    { key: "todo", category: "todo" },
    { key: "in_progress", category: "in_progress" },
    { key: "in_review", category: "in_review" },
    { key: "done", category: "done" },
    { key: "cancelled", category: "cancelled" },
  ],
  content: [
    { key: "backlog", category: "backlog" },
    { key: "brief", category: "todo" },
    { key: "ideation", category: "in_progress" },
    { key: "script", category: "in_progress" },
    { key: "design", category: "in_progress" },
    { key: "edit", category: "in_progress" },
    { key: "internal_review", category: "in_review" },
    { key: "client_review", category: "in_review" },
    { key: "scheduled", category: "in_progress" },
    { key: "published", category: "done" },
    { key: "reported", category: "done" },
    { key: "cancelled", category: "cancelled" },
  ],
};
export type WorkflowPreset = keyof typeof WORKFLOW_PRESETS;

/** Reactions on a comment (FR-WRK-09): a short fixed set, so a reaction is one tap and one meaning. */
export const REACTIONS = ["👍", "❤️", "🎉", "👀", "✅"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** The ways to look at a project's tasks (FR-WRK-05). */
export const WORK_VIEWS = ["list", "board", "calendar"] as const;
export type WorkView = (typeof WORK_VIEWS)[number];

export const INTAKE_AUDIENCES = ["entity", "group"] as const;
export type IntakeAudience = (typeof INTAKE_AUDIENCES)[number];
