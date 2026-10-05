// The performance module's scheduled jobs (morning).
import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { enrolProbationReviews } from "./probation-reviews";
import { sendOpenNotices } from "./review-notices";
import { sendReviewReminders } from "./review-reminders";

/** Puts the people whose probation is about to end into the open probation cycle, and tells them and their manager. */
export const performanceProbationJob: JobDefinition = {
  name: "performance-probation-reviews",
  run: async ({ today }) => {
    const enrolled = await enrolProbationReviews(today);
    const told = await sendOpenNotices(enrolled);
    return { enrolled: enrolled.length, ...told };
  },
};

/** Reviews due soon or overdue, sign-offs not recorded, reviews not acknowledged. Runs after the probation job in the morning. */
export const performanceRemindersJob: JobDefinition = { name: "performance-reminders", run: ({ today }) => sendReviewReminders(today) };
