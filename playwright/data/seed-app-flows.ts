import { ApiClient } from '../scripts/http.js';

// Supported-flow seed — creates actors, org structure, credentials, docker
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
}

export async function seedAppFlows(apiBase: string, env: Record<string, string>, ids: { githubBase: string; alibabaEndpoint: string; webFixture: string; apiFixture: string; dockerHost: string; dockerCa: string; dockerCert: string; dockerKey: string }): Promise<SeedResult> {
  const api = new ApiClient(apiBase);
  await api.login(env.PWP_ADMIN_USERNAME!, env.PWP_ADMIN_PASSWORD!);
  const ok = (r: { status: number; body: any }, w: string) => api.expectOk(r, w);
  const idOf = (o: any): string =>
    (o.id ?? (Object.values(o)[0] as any)?.id) as string;

  // Actors — editor/viewer through the admin user API.
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

  // Credentials (encrypted store — STORED kind).
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

  // Importer configs — all five implemented importers.
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
  await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'web-url', label: `pw-web-${env.PWP_RUN_ID}`,
    scope: { url: ids.webFixture }, enabled: true,
  }), 'web-url config');
  await ok(await api.post('/api/v1/importer-configs', {
    importerName: 'api-url', label: `pw-api-${env.PWP_RUN_ID}`,
    scope: { url: ids.apiFixture }, enabled: true,
  }), 'api-url config');

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
  await ok(await api.post(`/api/v1/components/${idOf(comp)}/url-checks`, {
    name: 'pw-none', url: 'http://probe.target.test/none',
    componentInstanceId: instanceId, method: 'GET', enabled: true,
    successPolicy: { codes: [200], ranges: [] }, authMode: 'NONE',
  }), 'check NONE');
  await ok(await api.post(`/api/v1/components/${idOf(comp)}/url-checks`, {
    name: 'pw-basic', url: 'http://auth.target.test/basic',
    componentInstanceId: instanceId, method: 'GET', enabled: true,
    successPolicy: { codes: [200], ranges: [] }, authMode: 'BASIC',
    credentialId: idOf(urlCheckCred),
    authConfig: { usernameKey: 'basicUser', passwordKey: 'basicPassword' },
  }), 'check BASIC');
  await ok(await api.post(`/api/v1/components/${idOf(comp)}/url-checks`, {
    name: 'pw-bearer', url: 'http://auth.target.test/bearer',
    componentInstanceId: instanceId, method: 'GET', enabled: true,
    successPolicy: { codes: [200], ranges: [] }, authMode: 'BEARER',
    credentialId: idOf(urlCheckCred), authConfig: { tokenKey: 'bearerToken' },
  }), 'check BEARER');
  await ok(await api.post(`/api/v1/components/${idOf(comp)}/url-checks`, {
    name: 'pw-custom', url: 'http://auth.target.test/custom',
    componentInstanceId: instanceId, method: 'GET', enabled: true,
    successPolicy: { codes: [200], ranges: [] }, authMode: 'CUSTOM_HEADERS',
    credentialId: idOf(urlCheckCred),
    authConfig: { headers: [{ name: 'X-PW-Check', key: 'headerValue' }] },
  }), 'check CUSTOM');

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
  };
}
