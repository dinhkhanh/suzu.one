// Shared by the validator, the editor and the reading view.
export const CALLOUT_KINDS = ["info", "warning", "success", "danger"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
