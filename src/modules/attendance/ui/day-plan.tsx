// How a planned day reads in words: "08:30–17:30", "22:00–06:00 (+1)", "Working from home — no punches".
import type { DayPlan, PlannedSegment } from "../engine/calendar";

const clock = (minutes: number) => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const segmentText = (segment: PlannedSegment) => `${clock(segment.start)}–${clock(segment.end)}${segment.end > 1440 ? " (+1)" : ""}`;

export const hoursText = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, "0") : ""}`;

export const planHours = (plan: Pick<DayPlan, "segments">) => plan.segments.map(segmentText).join(" · ");
