import {
  COMPONENT_CATEGORIES,
  COMPONENT_PROVIDERS,
  ENVIRONMENTS,
  COMPONENT_LIFECYCLE,
  INSTANCE_STATUS,
  PRODUCT_TYPES,
  IMPORT_RUN_STATUS,
  ROLES,
  EDGE_SUGGESTION_REASON,
  EDGE_SUGGESTION_STATUS,
} from "@componode/core";
import { sql } from "kysely";

/**
 * Generates a CHECK constraint SQL fragment from an array of allowed values.
 * Used by migrations to create CHECK constraints from core constants (ADR-078).
 */
export function checkConstraint(column: string, values: readonly string[]): ReturnType<typeof sql.raw> {
  const valueList = values.map((v) => `'${v}'`).join(", ");
  return sql.raw(`CHECK (${column} IN (${valueList}))`);
}

export const categoryCheck = checkConstraint("category", COMPONENT_CATEGORIES);
export const providerCheck = checkConstraint("provider", COMPONENT_PROVIDERS);
export const environmentCheck = checkConstraint("environment", ENVIRONMENTS);
export const lifecycleCheck = checkConstraint("lifecycle", COMPONENT_LIFECYCLE);
export const instanceStatusCheck = checkConstraint("status", INSTANCE_STATUS);
export const productTypeCheck = checkConstraint("type", PRODUCT_TYPES);
export const importRunStatusCheck = checkConstraint("status", IMPORT_RUN_STATUS);
export const roleCheck = checkConstraint("role", ROLES);
export const suggestionReasonCheck = checkConstraint("reason", EDGE_SUGGESTION_REASON);
export const suggestionStatusCheck = checkConstraint("status", EDGE_SUGGESTION_STATUS);
