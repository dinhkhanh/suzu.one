// The assistant's entry point for other modules and for its own routes. Nothing here grants
// anything: `ask` takes the asking user and retrieves with that person's own knowledge-base viewer.
import "server-only";

export { type AiMessageRow, answerQuestion, ask, type AskInput, type AskResult, type ConversationTurn, deleteConversation, getConversation, listConversations, listUnanswered, type Resolved, resolveAnswer, resolveUnanswered, type UnansweredRow } from "./conversations";
export { type ChatTurn, QUESTION_MAX, type ToolAnswer, type ToolOutcome, type ToolRefusal } from "./enums";
export { ANSWER_THRESHOLD, type Citation, type Passage, type RankedPassage } from "./engine/answer";
export { GLOSSARY, languageOf, questionVariants, translateWords } from "./engine/glossary";
export { assemblePrompt, SYSTEM_PROMPT } from "./engine/prompt";
export { type ApproverKind, APPROVER_KINDS, routeQuestion, type ToolName, type ToolRoute, TOOLS } from "./engine/routing";
export { buildToolUserMessage, ToolPromptRefusal } from "./engine/tool-prompt";
export { runTool, type ToolAudit, type ToolRun, type ToolUser } from "./tools";
export { chatDriver, type ChatDriver, LOCAL_DRIVER_NAME } from "./model";
export { canAskAssistant, canReadUnansweredLog } from "./policy";
export { CANDIDATES, retrievePassages } from "./retrieval";
