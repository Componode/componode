import type { ImporterSourceStatus } from "../constants/importer-source.js";

/**
 * ImporterSource — the durable provenance record an import run is
 * attributed to (ADR-119). Keyed by provider-native canonical identity,
 * scoped per importer. Internal provenance — never a catalog Component.
 */
export interface ImporterSource {
  id: string;
  importerName: string;
  /** Provider-native canonical, non-secret identity (canonicalized for
   *  URL identities — userinfo/auth params/fragments stripped). */
  externalIdentity: string;
  /** Display metadata only — Sources are never matched by label. */
  label: string | null;
  status: ImporterSourceStatus;
  boundConfigId: string | null;
  firstSeenInRunId: string | null;
  lastSeenInRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What an importer hands to `context.reportSourceIdentity`. */
export interface SourceIdentityInput {
  /** Provider-native canonical, non-secret identity of the external
   *  system being imported. Canonicalized executor-side before
   *  persistence. */
  externalIdentity: string;
  /** Optional display label — never used for matching. */
  label?: string;
}

/** Read-side summary of the config currently bound to a Source. */
export interface BoundConfigSummary {
  id: string;
  label: string;
}

/** API list/detail row — source + bound config + activity rollups. */
export interface ImporterSourceListItem extends ImporterSource {
  boundConfig: BoundConfigSummary | null;
  lastCompletedRunAt: string | null;
  activeComponentMemberships: number;
  activeInstanceMemberships: number;
}
