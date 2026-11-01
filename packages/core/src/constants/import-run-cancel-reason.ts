export const IMPORT_RUN_CANCEL_REASONS = [
  "USER_REQUESTED",
  "TARGET_DISABLED",
] as const;

export type ImportRunCancelReason = typeof IMPORT_RUN_CANCEL_REASONS[number];
