/**
 * Minimum password length for all password set/change paths (ADR-099).
 * Login intentionally uses a lower bound so legacy shorter passwords can
 * still authenticate until the user rotates them.
 */
export const PASSWORD_MIN_LENGTH = 12;
