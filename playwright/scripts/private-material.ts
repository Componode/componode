import 'reflect-metadata';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as x509 from '@peculiar/x509';
import { PRIVATE_DIR } from './env.js';

function secret(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

const RSA_ALG: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

function newKeys() {
  return crypto.subtle.generateKey(RSA_ALG, true, ['sign', 'verify']);
}

async function keyToPem(key: CryptoKey): Promise<string> {
  const der = await crypto.subtle.exportKey('pkcs8', key);
  const b64 = Buffer.from(der).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function makeCA(commonName: string) {
  const keys = await newKeys();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(8).toString('hex'),
    name: `CN=${commonName}`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000),
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign | x509.KeyUsageFlags.digitalSignature,
        true,
      ),
    ],
  });
  return { keys, cert };
}

async function issueLeaf(opts: {
  cn: string;
  sans: string[];
  ca: Awaited<ReturnType<typeof makeCA>>;
  client?: boolean;
}) {
  const keys = await newKeys();
  const usages =
    x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment;
  const eku = opts.client
    ? [x509.ExtendedKeyUsage.clientAuth]
    : [x509.ExtendedKeyUsage.serverAuth, x509.ExtendedKeyUsage.clientAuth];
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomBytes(8).toString('hex'),
    subject: `CN=${opts.cn}`,
    issuer: opts.ca.cert.subject,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000),
    publicKey: keys.publicKey,
    signingKey: opts.ca.keys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(usages, true),
      new x509.ExtendedKeyUsageExtension(eku, true),
      new x509.SubjectAlternativeNameExtension(
        opts.sans.map((dns) => ({ type: 'dns', value: dns }) as x509.GeneralName),
      ),
    ],
  });
  return {
    certPem: cert.toString('pem'),
    keyPem: await keyToPem(keys.privateKey),
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
    sans: [
      'mock-alibaba',
      'sts.aliyuncs.com',
      'business.aliyuncs.com',
      'resourcecenter.aliyuncs.com',
      'resourcecenter-intl.aliyuncs.com',
    ],
  },
  'mock-github': { cn: 'mock-github', sans: ['mock-github'] },
  'docker-engine': { cn: 'mock-docker-engine', sans: ['mock-docker-engine'] },
  'docker-client': { cn: 'componode-pw-docker-client', sans: ['componode-pw-docker-client'], client: true },
};

export async function generatePrivateMaterial(dir = PRIVATE_DIR): Promise<PrivateMaterial> {
  const certDir = join(dir, 'certs');
  mkdirSync(certDir, { recursive: true });

  const ca = await makeCA('Componode Playwright Workload CA');
  writeFileSync(join(dir, 'ca.crt'), ca.cert.toString('pem'), { mode: 0o600 });
  writeFileSync(join(dir, 'ca.key'), await keyToPem(ca.keys.privateKey), { mode: 0o600 });

  for (const [name, plan] of Object.entries(CERT_PLAN)) {
    const leaf = await issueLeaf({ cn: plan.cn, sans: plan.sans, ca, client: plan.client });
    writeFileSync(join(certDir, `${name}.crt`), leaf.certPem, { mode: 0o600 });
    writeFileSync(join(certDir, `${name}.key`), leaf.keyPem, { mode: 0o600 });
  }

  const runId = randomBytes(4).toString('hex');
  const envPath = join(dir, 'env');
  const lines = [
    `PWP_RUN_ID=${runId}`,
    `PWP_POSTGRES_PASSWORD=${secret()}`,
    `PWP_COOKIE_SECRET=${secret(32)}`,
    `PWP_SECRETS_KEY=${randomBytes(32).toString('base64')}`,
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
