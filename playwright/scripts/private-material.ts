import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import forge from 'node-forge';
import { PRIVATE_DIR } from './env.js';

const { pki } = forge;

function secret(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

function newKeyPair() {
  return pki.rsa.generateKeyPair(2048);
}

function baseCert() {
  const cert = pki.createCertificate();
  cert.serialNumber = randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000);
  return cert;
}

function makeCA(commonName: string) {
  const keys = newKeyPair();
  const cert = baseCert();
  const attrs = [{ name: 'commonName', value: commonName }];
  cert.publicKey = keys.publicKey;
  cert.subject.attributes = attrs;
  cert.issuer.attributes = attrs;
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, cert };
}

function issueLeaf(opts: {
  cn: string;
  sans: string[];
  ca: ReturnType<typeof makeCA>;
  client?: boolean;
}) {
  const keys = newKeyPair();
  const cert = baseCert();
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);
  cert.publicKey = keys.publicKey;
  cert.subject.attributes = [{ name: 'commonName', value: opts.cn }];
  cert.issuer.attributes = opts.ca.cert.subject.attributes;
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    {
      name: 'extKeyUsage',
      serverAuth: !opts.client,
      clientAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames: opts.sans.map((dns) => ({ type: 2, value: dns })),
    },
  ]);
  cert.sign(opts.ca.keys.privateKey, forge.md.sha256.create());
  return {
    certPem: pki.certificateToPem(cert),
    keyPem: pki.privateKeyToPem(keys.privateKey),
  };
}

export interface PrivateMaterial {
  caCrtPath: string;
  envPath: string;
  certDir: string;
}

/** Certificate/leaf plan — SAN lists the DNS names that must be covered. */
export const CERT_PLAN: Record<string, { cn: string; sans: string[]; client?: boolean }> = {
  'app-hub': { cn: 'app.componode-pw.test', sans: ['app.componode-pw.test', 'hub'] },
  dex: { cn: 'dex.componode-pw.test', sans: ['dex.componode-pw.test'] },
  'mock-alibaba': {
    cn: 'mock-alibaba',
    sans: ['mock-alibaba', 'sts.aliyuncs.com', 'business.aliyuncs.com'],
  },
  'mock-github': { cn: 'mock-github', sans: ['mock-github'] },
  'docker-engine': { cn: 'mock-docker-engine', sans: ['mock-docker-engine'] },
  'docker-client': { cn: 'componode-pw-docker-client', sans: ['componode-pw-docker-client'], client: true },
};

export function generatePrivateMaterial(dir = PRIVATE_DIR): PrivateMaterial {
  const certDir = join(dir, 'certs');
  mkdirSync(certDir, { recursive: true });

  const ca = makeCA('Componode Playwright Workload CA');
  writeFileSync(join(dir, 'ca.crt'), pki.certificateToPem(ca.cert), { mode: 0o600 });
  writeFileSync(join(dir, 'ca.key'), pki.privateKeyToPem(ca.keys.privateKey), { mode: 0o600 });

  for (const [name, plan] of Object.entries(CERT_PLAN)) {
    const leaf = issueLeaf({ cn: plan.cn, sans: plan.sans, ca, client: plan.client });
    writeFileSync(join(certDir, `${name}.crt`), leaf.certPem, { mode: 0o600 });
    writeFileSync(join(certDir, `${name}.key`), leaf.keyPem, { mode: 0o600 });
  }

  const runId = randomBytes(4).toString('hex');
  const envPath = join(dir, 'env');
  const lines = [
    `PWP_RUN_ID=${runId}`,
    `PWP_POSTGRES_PASSWORD=${secret()}`,
    `PWP_COOKIE_SECRET=${secret(32)}`,
    `PWP_ADMIN_USERNAME=pw-admin`,
    `PWP_ADMIN_PASSWORD=Pw!${secret(12)}`,
    `PWP_EDITOR_USERNAME=pw-editor`,
    `PWP_EDITOR_PASSWORD=Pw!${secret(12)}`,
    `PWP_VIEWER_USERNAME=pw-viewer`,
    `PWP_VIEWER_PASSWORD=Pw!${secret(12)}`,
    `PWP_GITHUB_TOKEN=pwghp_${secret(18)}`,
    `PWP_ALIBABA_ACCESS_KEY_ID=PWAID${secret(12)}`,
    `PWP_ALIBABA_ACCESS_KEY_SECRET=${secret(18)}`,
    `PWP_OIDC_CLIENT_ID=componode-pw`,
    `PWP_OIDC_CLIENT_SECRET=${secret(18)}`,
    `PWP_DEX_USER_EMAIL=dex-user@pw.test`,
    `PWP_DEX_USER_PASSWORD=Pw!${secret(12)}`,
    `PWP_URLCHECK_BASIC_USER=probe-${runId}`,
    `PWP_URLCHECK_BASIC_PASSWORD=Pw!${secret(12)}`,
    `PWP_URLCHECK_BEARER_TOKEN=pwt_${secret(18)}`,
    `PWP_URLCHECK_HEADER_VALUE=pwh_${secret(18)}`,
  ];
  writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
  return { caCrtPath: join(dir, 'ca.crt'), envPath, certDir };
}

export function privateMaterialExists(dir = PRIVATE_DIR): boolean {
  return existsSync(join(dir, 'ca.crt')) && existsSync(join(dir, 'env'));
}
