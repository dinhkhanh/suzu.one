// Plain values shared by the server and the client. **Not** a `server-only` module and not the
// service: a constant exported from a `"use server"` or `server-only` file becomes a client
// reference (or drags postgres into the browser bundle), which is a lesson this codebase has
// already learnt twice.

export const CADENCES = ["daily", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 7] as const;

export const REPORT_RUN_STATUSES = ["succeeded", "partial", "failed"] as const;
export type ReportRunStatus = (typeof REPORT_RUN_STATUSES)[number];
