import { ApiClient } from '../scripts/http.js';
import pg from 'pg';
import { PackageURL } from 'packageurl-js';
import { randomUUID as genId } from 'node:crypto';

// Mirrors @componode/core `normalizePurlIdentity` (packages/core/src/utils/
// purl.ts) — the version-free purl identity seeded on bom_entries rows. The
// runner image installs only this workspace's deps, and /repo is mounted
// read-only, so core's source cannot be imported directly here; same
// packageurl-js version as core is pinned in package.json.
function normalizePurlIdentity(purl: string): string | null {
  try {
    const parsed = PackageURL.fromString(purl);
    return new PackageURL(
      parsed.type,
      parsed.namespace,
      parsed.name,
      null,
      null,
      null,
    ).toString();
  } catch {
    return null;
  }
}

// Supported-flow seed  --  creates actors, org structure, credentials, docker
// target, importer configs, OIDC config, monitoring, and the Import Agent
// through real API calls (encrypted/lifecycle data never inserted directly).

export interface SeedResult {
  editorId: string;
  viewerId: string;
  agentId: string;
  agentToken: string;
  githubConfigId: string;
  oidcCredentialId: string;
  urlCheckCredentialId: string;
  dockerTargetCredentialId: string;
  probeComponentId: string;
  probeInstanceId: string;
  bomSlug: string;
  bomStaleSlug: string;
  sbomConfigId: string;
  edgeSlug: string;
}

export async function seedAppFlows(apiBase: string, pgUrl: string, env: Record<string, string>, ids: { githubBase: string; alibabaEndpoint: string; webFixture: string; apiFixture: string; dockerHost: string; dockerCa: string; dockerCert: string; dockerKey: string }): Promise<SeedResult> {
  const api = new ApiClient(apiBase);
  await api.login(env.PWP_ADMIN_USERNAME!, env.PWP_ADMIN_PASSWORD!);
  const ok = (r: { status: number; body: any }, w: string) => api.expectOk(r, w);
  const idOf = (o: any): string =>
    (o.id ?? (Object.values(o)[0] as any)?.id) as string;

  // Actors  --  editor/viewer through the admin user API.
  const editor = await ok(await api.post('/api/v1/users', {
    username: env.PWP_EDITOR_USERNAME, password: env.PWP_EDITOR_PASSWORD,
    role: 'EDITOR', displayName: 'PW Editor',
  }), 'create editor');
  const viewer = await ok(await api.post('/api/v1/users', {
    username: env.PWP_VIEWER_USERNAME, password: env.PWP_VIEWER_PASSWORD,
    role: 'VIEWER', displayName: 'PW Viewer',
  }), 'create viewer');

  // Organization structure.
  const lob = await ok(await api.post('/api/v1/lobs', { name: 'PW LoB', slug: `pw-lob-${env.PWP_RUN_ID}` }), 'create lob');
  await ok(await api.post('/api/v1/teams', { name: 'PW Team', slug: `pw-team-${env.PWP_RUN_ID}`, lobId: idOf(lob) }), 'create team');

  // Products: platform + business capability + compose edge.
  const platform = await ok(await api.post('/api/v1/products', { name: 'PW Platform', slug: `pw-platform-${env.PWP_RUN_ID}`, type: 'PLATFORM' }), 'create platform');
  const bc = await ok(await api.post('/api/v1/products', { name: 'PW Capability', slug: `pw-capability-${env.PWP_RUN_ID}`, type: 'BUSINESS_CAPABILITY' }), 'create bc');
  await ok(await api.post(`/api/v1/products/${idOf(bc)}/composes`, { childId: idOf(platform) }), 'compose edge');
  await ok(await api.post(`/api/v1/products/${idOf(bc)}/consumes-from`, { platformId: idOf(platform) }), 'consumes edge');

  // Component group + a product component dependency.
  const group = await ok(await api.post('/api/v1/component-groups', { name: 'PW Group', slug: `pw-group-${env.PWP_RUN_ID}` }), 'create group');

  // Credentials (encrypted store  --  STORED kind).
  const githubCred = await ok(await api.post('/api/v1/credentials', {
    label: `pw-github-${env.PWP_RUN_ID}`, secrets: { token: env.PWP_GITHUB_TOKEN },
  }), 'github credential');
  const alibabaCred = await ok(await api.post('/api/v1/credentials', {
    label: `pw-alibaba-${env.PWP_RUN_ID}`,
    secrets: { accessKeyId: env.PWP_ALIBABA_ACCESS_KEY_ID, accessKeySecret: env.PWP_ALIBABA_ACCESS_KEY_SECRET },
  }), 'alibaba credential');
  const dockerCred = await ok(await api.post('/api/v1/credentials', {
    label: `pw-docker-${env.PWP_RUN_ID}`,
    secrets: { caCert: ids.dockerCa, clientCert: ids.dockerCert, clientKey: ids.dockerKey },
  }), 'docker credential');
  const urlCheckCred = await ok(await api.post('/api/v1/credentials', {
    label: `pw-urlcheck-${env.PWP_RUN_ID}`,
    secrets: {
      basicUser: env.PWP_URLCHECK_BASIC_USER, basicPassword: env.PWP_URLCHECK_BASIC_PASSWORD,
      bearerToken: env.PWP_URLCHECK_BEARER_TOKEN, headerValue: env.PWP_URLCHECK_HEADER_VALUE,
    },
  }), 'urlcheck credential');
  const oidcCred = await ok(await api.post('/api/v1/credentials', {
    label: `pw-oidc-${env.PWP_RUN_ID}`, secrets: { clientSecret: env.PWP_OIDC_CLIENT_SECRET },
  }), 'oidc credential');

  // Docker target (tcp+mTLS profile referencing credential keys).
  await ok(await api.post('/api/v1/docker-targets', {
    targetId: 'pw-engine', label: 'PW Engine',
    profile: {
      transport: 'tcp', host: ids.dockerHost, port: 2376,
      caCertKey: 'caCert', clientCertKey: 'clientCert', clientKeyKey: 'clientKey',
    },
  }), 'docker target');

  // Importer configs  --  all five implemented importers.
  const githubCfg = await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'github', label: `pw-github-${env.PWP_RUN_ID}`,
    scope: { org: 'pw-org', baseUrl: ids.githubBase },
    credentialIds: [idOf(githubCred)], enabled: true,
  }), 'github config');
  await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'alibaba-cloud', label: `pw-alibaba-${env.PWP_RUN_ID}`,
    scope: {},
    credentialIds: [idOf(alibabaCred)], enabled: true,
  }), 'alibaba config');
  await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'docker', label: `pw-docker-${env.PWP_RUN_ID}`,
    scope: { targetId: 'pw-engine', includeImages: true },
    credentialIds: [idOf(dockerCred)], enabled: true,
  }), 'docker config');
  const collectionScope = (name: string, url: string) => ({
    sourceKey: genId(),
    components: [{
      componentKey: genId(),
      name,
      instances: [{
        instanceKey: genId(),
        environment: 'PRODUCTION',
        url,
        check: {
          checkKey: genId(),
          name: `${name} availability`,
          method: 'GET',
          enabled: true,
          successPolicy: { codes: [200], ranges: [] },
          authMode: 'NONE',
        },
      }],
    }],
  });
  await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'web-url', label: `pw-web-${env.PWP_RUN_ID}`,
    scope: collectionScope('PW Web Fixture', ids.webFixture), enabled: true,
  }), 'web-url config');
  await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'api-url', label: `pw-api-${env.PWP_RUN_ID}`,
    scope: collectionScope('PW API Fixture', ids.apiFixture), enabled: true,
  }), 'api-url config');

  // Spec 073 — a catalog component the sbom-file importer targets (the
  // CycloneDX fixture is served by the github mock), plus a second
  // component whose stale multi-source rows are seeded via pg below. The
  // target needs an externalId (save validation requires it — importer
  // components always carry one); the manual create leaves it NULL, so it
  // is backfilled in the pg block before the config is created.
  const bomComp = await ok(await api.post('/api/v1/components', {
    name: 'PW BOM Target', slug: `pw-bom-${env.PWP_RUN_ID}`,
    category: 'LIBRARY', provider: 'OTHER', resourceType: 'pw-bom-target',
  }), 'bom component');
  const bomStaleComp = await ok(await api.post('/api/v1/components', {
    name: 'PW BOM Stale', slug: `pw-bom-stale-${env.PWP_RUN_ID}`,
    category: 'LIBRARY', provider: 'OTHER', resourceType: 'pw-bom-stale',
  }), 'stale bom component');

  // Spec 077 — a second sbom-file target for the declared-edge e2e. It must
  // NOT be a LIBRARY: library neighbours collapse into libraryCounts, so an
  // SBOM target that renders importer-added edges as rows on the libraries'
  // dependedOnBy lanes has to be a regular component.
  const edgeComp = await ok(await api.post('/api/v1/components', {
    name: 'PW Edge Target', slug: `pw-edge-${env.PWP_RUN_ID}`,
    category: 'COMPUTE', provider: 'OTHER', resourceType: 'pw-edge-target',
  }), 'sbom edge target component');

  // OIDC configuration pointing at Dex.
  await ok(await api.put('/api/v1/settings/oidc', {
    enabled: true, issuer: 'https://dex.componode-pw.test',
    clientId: env.PWP_OIDC_CLIENT_ID, clientSecretCredentialId: idOf(oidcCred),
  }), 'oidc config');

  // Probe component: API component with an instance + monitoring setup + checks.
  const comp = await ok(await api.post('/api/v1/components', {
    name: 'PW Probe API', slug: `pw-probe-${env.PWP_RUN_ID}`,
    category: 'API', provider: 'API_URL', resourceType: 'pw-endpoint',
    instance: { environment: 'PRODUCTION', url: 'http://probe.target.test' },
  }), 'probe component');
  const compDetail = await ok(await api.get(`/api/v1/components/${idOf(comp)}`), 'component detail');
  const instList = compDetail.instances ?? compDetail.component?.instances ?? [];
  const instanceId = instList[0]?.id;
  await ok(await api.put(`/api/v1/components/${idOf(comp)}/monitoring-setup`, {
    cadenceSeconds: 60, vantage: 'HUB',
  }), 'monitoring setup');

  // Direct URL Check writes are deprecated (spec 058 FR-021) - the write
  // route returns 410. Workload probe checks are seeded directly so the
  // specs exercise dispatch/observation behavior, not the retired API.
  const pgClient = new pg.Client({ connectionString: pgUrl });
  await pgClient.connect();
  const setupId = (await pgClient.query(
    'SELECT id FROM component_monitoring_setups WHERE "componentId" = $1',
    [idOf(comp)],
  )).rows[0].id;
  const seedCheck = (
    name: string, url: string, authMode: string,
    credentialId: string | null, authConfig: unknown | null,
  ) =>
    pgClient.query(
      `INSERT INTO url_checks
         (id, "setupId", "componentInstanceId", "credentialId", name, url,
          method, enabled, "successPolicy", "authMode", "authConfig",
          "nextProbeAt")
       VALUES ($1,$2,$3,$4,$5,$6,'GET',true,$7,$8,$9,now())`,
      [
        genId(), setupId, instanceId, credentialId, name, url,
        JSON.stringify({ codes: [200], ranges: [] }),
        authMode, authConfig ? JSON.stringify(authConfig) : null,
      ],
    );
  await seedCheck('pw-none', 'http://probe.target.test:9080/none', 'NONE', null, null);
  await seedCheck('pw-basic', 'http://auth.target.test:9080/basic', 'BASIC',
    idOf(urlCheckCred), { usernameKey: 'basicUser', passwordKey: 'basicPassword' });
  await seedCheck('pw-bearer', 'http://auth.target.test:9080/bearer', 'BEARER',
    idOf(urlCheckCred), { tokenKey: 'bearerToken' });
  await seedCheck('pw-custom', 'http://auth.target.test:9080/custom', 'CUSTOM_HEADERS',
    idOf(urlCheckCred), { headers: [{ name: 'X-PW-Check', key: 'headerValue' }] });

  // Spec 073 — stale multi-source BOM rows. Staleness can't be produced
  // through the API (it derives from lastReportedAt age), so these rows
  // are seeded directly: two sources × old timestamps drive the stale
  // warning and the multi-source "Last reported" popover.
  const srcIds: string[] = [];
  for (const [identity, label] of [
    ['pw:bom-stale-a', 'PW Stale Source A'],
    ['pw:bom-stale-b', 'PW Stale Source B'],
  ] as const) {
    const sid = genId();
    srcIds.push(sid);
    await pgClient.query(
      `INSERT INTO importer_sources (id, "importerName", "externalIdentity", label, status)
       VALUES ($1,$2,$3,$4,'ACTIVE')`,
      [sid, 'sbom-file', identity, label],
    );
  }
  const bomRow = (
    compId: string, srcId: string, purl: string, name: string,
    version: string, scope: string, direct: boolean,
    ecosystem = 'npm', lastReportedDaysAgo = 10,
  ) =>
    pgClient.query(
      `INSERT INTO bom_entries
         (id, "componentId", purl, "purlIdentity", name, version, ecosystem, scope,
          "evidenceSource", "evidenceDetail", licenses, direct,
          "lastReportedAt", "sourceId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SBOM_DOCUMENT','pw-seed','[]'::jsonb,$9,
               now() - make_interval(days => $10), $11)`,
      [genId(), compId, purl, normalizePurlIdentity(purl) ?? purl, name,
       version, ecosystem, scope, direct, lastReportedDaysAgo, srcId],
    );
  const staleId = idOf(bomStaleComp);
  await bomRow(staleId, srcIds[0]!, 'pkg:npm/pw-stale-lib@1.0.0', 'pw-stale-lib', '1.0.0', 'RUNTIME', true);
  await bomRow(staleId, srcIds[0]!, 'pkg:npm/pw-stale-dev@2.0.0', 'pw-stale-dev', '2.0.0', 'DEV', false);
  await bomRow(staleId, srcIds[1]!, 'pkg:npm/pw-stale-trans@0.1.0', 'pw-stale-trans', '0.1.0', 'TRANSITIVE', false);

  // Spec 074 — a package shared by two components at different versions:
  // /packages merges them into one row (versionCount 2, componentCount 2)
  // and version chips filter the expanded consumers panel.
  const sharedId = idOf(bomComp);
  // WARNING: rows on the stale component must stay OLD — component-level
  // staleness derives from max(lastReportedAt), so any fresh row on
  // bomStaleComp silently defeats the spec-073 stale-inventory fixture.
  await bomRow(staleId, srcIds[0]!, 'pkg:npm/pw-shared-lib@2.0.0', 'pw-shared-lib', '2.0.0', 'RUNTIME', true, 'npm', 10);
  await bomRow(sharedId, srcIds[1]!, 'pkg:npm/pw-shared-lib@1.9.0', 'pw-shared-lib', '1.9.0', 'RUNTIME', false, 'npm', 3);

  // sbom-file targeting requires an externalId on the component — the
  // manual create leaves it NULL, so backfill it (as an importer would)
  // before the config's save-time slug validation runs.
  await pgClient.query(
    `UPDATE components SET "externalId" = 'pw:bom-target' WHERE id = $1`,
    [idOf(bomComp)],
  );
  await pgClient.query(
    `UPDATE components SET "externalId" = 'pw:edge-target' WHERE id = $1`,
    [idOf(edgeComp)],
  );
  await pgClient.end();
  const bomCfg = await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'sbom-file', label: `pw-sbom-${env.PWP_RUN_ID}`,
    scope: {
      sbomUrl: 'https://mock-github:9443/sbom/cyclonedx.json',
      componentSlug: `pw-bom-${env.PWP_RUN_ID}`,
    },
    enabled: true,
  }), 'sbom-file config');

  // Import Agent + enrollment token (token written by caller into .env-private).
  const agent = await ok(await api.post('/api/v1/agents', { name: `pw-agent-${env.PWP_RUN_ID}` }), 'create agent');
  const enroll = await ok(await api.post(`/api/v1/agents/${idOf(agent)}/enroll`, {}), 'agent enroll');

  // Trigger one suggestion rescan so pending suggestions exist.
  await api.post('/api/v1/suggestions/rescan', {});

  return {
    editorId: idOf(editor), viewerId: idOf(viewer),
    agentId: idOf(agent), agentToken: enroll.enrollment?.token ?? enroll.token ?? '',
    githubConfigId: idOf(githubCfg),
    oidcCredentialId: idOf(oidcCred), urlCheckCredentialId: idOf(urlCheckCred),
    dockerTargetCredentialId: idOf(dockerCred),
    probeComponentId: idOf(comp), probeInstanceId: instanceId,
    bomSlug: `pw-bom-${env.PWP_RUN_ID}`,
    bomStaleSlug: `pw-bom-stale-${env.PWP_RUN_ID}`,
    sbomConfigId: idOf(bomCfg),
    edgeSlug: `pw-edge-${env.PWP_RUN_ID}`,
  };
}
