// The registry, in its fixed order: the order is part of the cached prefix of every request, so a
// new tool goes at the end of its group and the groups do not move.
import "server-only";
import type { AnyAgentTool } from "../registry";
import { KB_TOOLS } from "./kb";
import { SELF_TOOLS } from "./self";

export const AGENT_TOOLS: readonly AnyAgentTool[] = [...KB_TOOLS, ...SELF_TOOLS];
