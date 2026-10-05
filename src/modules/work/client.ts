// Work management's entry point for other modules' screens, beside `service.ts` for the server.
// Only what is safe in the browser: the value lists and the pieces of screen other modules show.
// Nothing here reaches the database.
export * from "./enums";
export { type ClientContactChoice, ContactSuggestions } from "./ui/client-decision";
export { EditProjectButton } from "./ui/edit-dialogs";
export { posterUrlOf } from "./ui/project-poster";
