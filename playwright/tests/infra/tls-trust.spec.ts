import { test, expect } from '@playwright/test';
import { connect } from 'node:tls';
import { readFileSync } from 'node:fs';

function peerCert(host: string, port: number, ca: string): Promise<{ issuer: string; authorized: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const sock = connect({ host, port, ca, servername: host }, () => {
      const cert = sock.getPeerCertificate();
      resolvePromise({ issuer: cert.issuer.CN as string, authorized: sock.authorized });
      sock.end();
    });
    sock.on('error', reject);
  });
}

test.describe('local HTTPS trust (no verification bypass)', () => {
  test('app presents a workload-CA chain the process trusts', async () => {
    const ca = readFileSync('/pw-private/ca.crt', 'utf8');
    const { issuer, authorized } = await peerCert('app.componode-pw.test', 443, ca);
    expect(authorized).toBeTruthy();
    expect(issuer).toBe('Componode Playwright Workload CA');
  });

  test('Node fetch trusts the app CA bundle via NODE_EXTRA_CA_CERTS', async () => {
    const res = await fetch('https://app.componode-pw.test/api/v1/health');
    expect(res.ok).toBeTruthy();
  });

  test('Dex discovery document is served over trusted TLS', async () => {
    const res = await fetch('https://dex.componode-pw.test/.well-known/openid-configuration');
    expect(res.ok).toBeTruthy();
    const doc = await res.json();
    expect(doc.issuer).toBe('https://dex.componode-pw.test');
  });

  test('browser context loads the app over real TLS @smoke', async ({ page, browserName }) => {
    test.skip(
      browserName === 'firefox',
      'juggler profile cannot import the workload CA — see HANDOFF findings',
    );
    const res = await page.goto('/login');
    expect(res?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/componode/i);
  });
});
