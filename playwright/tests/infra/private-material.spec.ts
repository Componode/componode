import 'reflect-metadata';
import { test, expect } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import { generatePrivateMaterial, CERT_PLAN } from '../../scripts/private-material.js';

test.describe('private material generation', () => {
  test('writes every generated secret and certificate under the private dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-env-private-'));
    const { caCrtPath, envPath, certDir } = await generatePrivateMaterial(dir);
    expect(caCrtPath.startsWith(dir)).toBeTruthy();
    expect(envPath.startsWith(dir)).toBeTruthy();
    for (const name of Object.keys(CERT_PLAN)) {
      expect(existsSync(join(certDir, `${name}.crt`))).toBeTruthy();
      expect(existsSync(join(certDir, `${name}.key`))).toBeTruthy();
    }
    expect(existsSync(join(dir, 'ca.crt'))).toBeTruthy();
    expect(existsSync(join(dir, 'ca.key'))).toBeTruthy();
  });

  test('leaf certificates carry the SANs needed by mock hostnames', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-env-private-'));
    const { certDir } = await generatePrivateMaterial(dir);
    const cert = new x509.X509Certificate(readFileSync(join(certDir, 'mock-alibaba.crt'), 'utf8'));
    const sanExt = cert.getExtension('2.5.29.17') as x509.SubjectAlternativeNameExtension | undefined;
    expect(sanExt).toBeTruthy();
    const text = sanExt!.toString();
    for (const name of ['sts.aliyuncs.com', 'business.aliyuncs.com', 'mock-alibaba']) {
      expect(text).toContain(name);
    }
  });

  test('generated env values differ between runs', async () => {
    const a = mkdtempSync(join(tmpdir(), 'pw-env-a-'));
    const b = mkdtempSync(join(tmpdir(), 'pw-env-b-'));
    await generatePrivateMaterial(a);
    await generatePrivateMaterial(b);
    const envA = readFileSync(join(a, 'env'), 'utf8');
    const envB = readFileSync(join(b, 'env'), 'utf8');
    expect(envA).not.toBe(envB);
    expect(envA).toMatch(/PWP_ADMIN_PASSWORD=Pw![A-Za-z0-9_-]+/);
  });

  test('no generated file lands outside the private directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-env-private-'));
    await generatePrivateMaterial(dir);
    for (const entry of readdirSync(dir, { recursive: true })) {
      expect(entry.toString()).not.toMatch(/\.env\.test/);
    }
  });
});
