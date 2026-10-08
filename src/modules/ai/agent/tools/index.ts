// The registry, in its fixed order: the order is part of the cached prefix of every request, so a
// new tool goes at the end of its group and the groups do not move.
import "server-only";
import type { AnyAgentTool } from "../registry";
import { HR_TOOLS } from "./hr";
import { KB_TOOLS } from "./kb";
import { LOOKUP_TOOLS } from "./lookup";
import { MONEY_TOOLS } from "./money";
import { PEOPLE_TOOLS } from "./people";
import { PROPOSE_DAILY_TOOLS } from "./propose-daily";
import { PROPOSE_REQUEST_TOOLS } from "./propose-requests";
import { PROPOSE_WORK_TOOLS } from "./propose-work";
import { REPORT_TOOLS } from "./reports";
import { SELF_TOOLS } from "./self";
import { WORK_TOOLS } from "./work";

export const AGENT_TOOLS: readonly AnyAgentTool[] = [
  ...KB_TOOLS,
  ...SELF_TOOLS,
  ...LOOKUP_TOOLS,
  ...WORK_TOOLS,
  ...PEOPLE_TOOLS,
  ...HR_TOOLS,
  ...MONEY_TOOLS,
  ...REPORT_TOOLS,
  ...PROPOSE_WORK_TOOLS,
  ...PROPOSE_DAILY_TOOLS,
  ...PROPOSE_REQUEST_TOOLS,
];
