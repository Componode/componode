import { test, expect } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { generatePrivateMaterial, CERT_PLAN } from '../../scripts/private-material.js';

test.describe('private material generation', () => {
  test('writes every generated secret and certificate under .env-private-style dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-env-private-'));
    const { caCrtPath, envPath, certDir } = generatePrivateMaterial(dir);
    expect(caCrtPath.startsWith(dir)).toBeTruthy();
    expect(envPath.startsWith(dir)).toBeTruthy();
    for (const name of Object.keys(CERT_PLAN)) {
      expect(existsSync(join(certDir, `${name}.crt`))).toBeTruthy();
      expect(existsSync(join(certDir, `${name}.key`))).toBeTruthy();
    }
    expect(existsSync(join(dir, 'ca.crt'))).toBeTruthy();
    expect(existsSync(join(dir, 'ca.key'))).toBeTruthy();
  });

  test('leaf certificates carry the SANs needed by mock hostnames', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-env-private-'));
    const { certDir } = generatePrivateMaterial(dir);
    const alibabaPem = readFileSync(join(certDir, 'mock-alibaba.crt'), 'utf8');
    const cert = forge.pki.certificateFromPem(alibabaPem);
    const san = cert.getExtension('subjectAltName') as { altNames: { value: string }[] };
    const names = san.altNames.map((a) => a.value);
    expect(names).toEqual(
      expect.arrayContaining(['sts.aliyuncs.com', 'business.aliyuncs.com', 'mock-alibaba']),
    );
  });

  test('generated env values differ between runs and stay out of stdout', () => {
    const a = mkdtempSync(join(tmpdir(), 'pw-env-a-'));
    const b = mkdtempSync(join(tmpdir(), 'pw-env-b-'));
    generatePrivateMaterial(a);
    generatePrivateMaterial(b);
    const envA = readFileSync(join(a, 'env'), 'utf8');
    const envB = readFileSync(join(b, 'env'), 'utf8');
    expect(envA).not.toBe(envB);
    expect(envA).toMatch(/PWP_ADMIN_PASSWORD=Pw![A-Za-z0-9_-]+/);
  });

  test('no generated file lands outside the private directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-env-private-'));
    generatePrivateMaterial(dir);
    for (const entry of readdirSync(dir, { recursive: true })) {
      expect(entry.toString()).not.toMatch(/\.env\.test|\.env(?!-private)/);
    }
  });
});
