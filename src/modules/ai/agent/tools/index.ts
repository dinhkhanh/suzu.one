// The registry, in its fixed order: the order is part of the cached prefix of every request, so a
// new tool goes at the end of its group and the groups do not move.
import "server-only";
import type { AnyAgentTool } from "../registry";
import { KB_TOOLS } from "./kb";
import { LOOKUP_TOOLS } from "./lookup";
import { PEOPLE_TOOLS } from "./people";
import { SELF_TOOLS } from "./self";
import { WORK_TOOLS } from "./work";

export const AGENT_TOOLS: readonly AnyAgentTool[] = [...KB_TOOLS, ...SELF_TOOLS, ...LOOKUP_TOOLS, ...WORK_TOOLS, ...PEOPLE_TOOLS];
