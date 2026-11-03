// Table coverage registry — every application-owned persistent table must
// have a documented fixture or lifecycle source. Two Kysely bookkeeping
// tables are excluded. Kept in sync with playwright/data/fixture-matrix.md.

export type CoverageSource = 'bulk' | 'flow' | 'runtime' | 'excluded';

export const TABLE_COVERAGE: Record<string, { source: CoverageSource; note: string }> = {
  digital_products: { source: 'flow', note: 'API create/edit/retire journeys' },
  components: { source: 'bulk', note: '201 deterministic rows + importer output' },
  component_instances: { source: 'flow', note: 'bulk env rows + first-instance recovery + probes' },
  component_groups: { source: 'flow', note: 'API group lifecycle' },
  line_of_businesses: { source: 'flow', note: 'Admin API' },
  teams: { source: 'flow', note: 'Admin API' },
  product_composes: { source: 'flow', note: 'product hierarchy edges' },
  product_consumes_from: { source: 'flow', note: 'platform consumption edges' },
  product_depends_on_component: { source: 'flow', note: 'product dependency edges' },
  product_depends_on_component_group: { source: 'flow', note: 'product group dependency' },
  component_depends_on_component: { source: 'flow', note: 'component dependency edges' },
  component_sources_from: { source: 'runtime', note: 'importer reconciliation' },
  component_exposes: { source: 'flow', note: 'component relationship flow' },
  persons: { source: 'flow', note: 'bootstrap admin + admin-created users + Dex JIT' },
  sessions: { source: 'flow', note: 'real logins' },
  password_reset_tokens: { source: 'flow', note: 'admin reset flow' },
  oidc_config: { source: 'flow', note: 'admin OIDC settings to Dex' },
  importer_configs: { source: 'flow', note: 'importer config API' },
  importer_config_credentials: { source: 'flow', note: 'credential linkage' },
  credentials: { source: 'flow', note: 'encrypted store via API' },
  import_agents: { source: 'flow', note: 'agent create/enroll' },
  agent_sessions: { source: 'runtime', note: 'real WSS session' },
  import_runs: { source: 'runtime', note: 'real importer runs' },
  import_run_errors: { source: 'runtime', note: 'controlled mock errors' },
  importer_sources: { source: 'runtime', note: 'source identity reporting' },
  source_component_memberships: { source: 'runtime', note: 'reconciliation' },
  source_instance_memberships: { source: 'runtime', note: 'reconciliation' },
  source_url_check_memberships: { source: 'runtime', note: 'managed-check ownership (spec 058)' },
  docker_targets: { source: 'flow', note: 'admin target API' },
  entity_changes: { source: 'runtime', note: 'audit of mutations' },
  edge_changes: { source: 'runtime', note: 'audit of edge mutations' },
  edge_suggestions: { source: 'flow', note: 'suggestion rescan + decisions (+ bulk boundary rows)' },
  component_monitoring_setups: { source: 'flow', note: 'monitoring setup API' },
  url_checks: { source: 'flow', note: 'composite + standalone checks' },
  url_check_observations: { source: 'runtime', note: 'real Hub/Agent probes' },
  app_settings: { source: 'flow', note: 'admin settings toggles' },
  kysely_migration: { source: 'excluded', note: 'migration bookkeeping' },
  kysely_migration_lock: { source: 'excluded', note: 'migration bookkeeping' },
};

export const APP_TABLES = Object.keys(TABLE_COVERAGE).filter(
  (t) => TABLE_COVERAGE[t]!.source !== 'excluded',
);
export const EXCLUDED_TABLES = Object.keys(TABLE_COVERAGE).filter(
  (t) => TABLE_COVERAGE[t]!.source === 'excluded',
);
