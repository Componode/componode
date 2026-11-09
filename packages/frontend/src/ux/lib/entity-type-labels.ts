/**
 * Canonical audit `entity_type` → display label registry (spec 069 / B.7).
 * Single source for surfaces that render raw entity-type slugs — the
 * activity page's type filter and any future label needs. Slugs match the
 * backend `entity_type` CHECK domain; consumers fall back to the raw slug
 * for unknown values.
 */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  digital_product: "Digital product",
  component: "Component",
  component_instance: "Component instance",
  component_group: "Component group",
  team: "Team",
  line_of_business: "Line of business",
  import_agent: "Import agent",
  docker_target: "Docker target",
  importer_source: "Importer source",
  importer_config: "Importer config",
  credential: "Credential",
  url_check: "URL check",
  monitoring_setup: "Monitoring setup",
  user: "User",
  settings: "Settings",
  session: "Session",
  auth: "Authentication",
  correction: "Correction",
};
