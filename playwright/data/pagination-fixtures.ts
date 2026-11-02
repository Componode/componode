// Deterministic volumes for pagination boundary coverage.
export const COMPONENT_COUNT = 201; // two full pageSize-100 pages + tail
export const ACTIVITY_COUNT = 101; // two full limit-50 pages + tail
export const SUGGESTION_COUNT = 101;
export const RUN_PREFIX = process.env.PW_RUN_ID ?? 'local';
