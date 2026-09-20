// Internal communications' scheduled jobs.
import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { notifyDueAnnouncements } from "./announcements";

/**
 * Midnight and morning: tells the audience of scheduled announcements whose hour has come. The
 * announcement itself is visible from its exact hour (computed on read); only the notice waits.
 */
export const commsAnnouncementsJob: JobDefinition = { name: "comms-announcements", run: () => notifyDueAnnouncements() };
