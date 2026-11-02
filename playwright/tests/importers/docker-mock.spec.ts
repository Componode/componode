import { test, expect } from '@playwright/test';
import { request } from 'node:https';
import { readFileSync } from 'node:fs';

const CTL = 'http://mock-control:9090';

function engineGet(path: string, withClientCert = true): Promise<{ status: number; body: any }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        host: 'mock-docker-engine', port: 2376, path, method: 'GET',
        ca: readFileSync('/pw-private/ca.crt'),
        ...(withClientCert
          ? { cert: readFileSync('/pw-private/certs/docker-client.crt'), key: readFileSync('/pw-private/certs/docker-client.key') }
          : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolvePromise({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch { resolvePromise({ status: res.statusCode ?? 0, body: null }); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-docker-engine`, { method: 'POST', body: JSON.stringify({ name }) });
}

test.describe('docker engine mTLS mock contracts', () => {
  test('rejects connections without a client certificate', async () => {
    await expect(engineGet('/version', false)).rejects.toThrow();
  });

  test('serves importer read endpoints with client cert', async () => {
    await scenario('baseline');
    const info = await engineGet('/info');
    expect(info.status).toBe(200);
    expect(info.body.ID).toBeTruthy();
    const ver = await engineGet('/version');
    expect(parseFloat(ver.body.ApiVersion)).toBeGreaterThanOrEqual(1.41);
    const containers = await engineGet('/containers/json?all=1');
    expect(containers.body.length).toBeGreaterThan(0);
    const inspect = await engineGet(`/containers/${containers.body[0].Id}/json`);
    expect(inspect.status).toBe(200);
    expect((await engineGet('/images/json')).body.length).toBeGreaterThan(0);
  });

  test('swarm scenario adds services/nodes/secrets', async () => {
    await scenario('swarm');
    expect((await engineGet('/services?status=true')).body.length).toBeGreaterThan(0);
    expect((await engineGet('/nodes')).body.length).toBeGreaterThan(0);
    expect((await engineGet('/secrets')).body.length).toBeGreaterThan(0);
    const info = await engineGet('/info');
    expect(info.body.Swarm.LocalNodeState).toBe('active');
  });

  test('old-api scenario reports API below the Swarm floor', async () => {
    await scenario('old-api');
    const ver = await engineGet('/version');
    expect(parseFloat(ver.body.ApiVersion)).toBeLessThan(1.41);
  });

  test('versioned API paths resolve identically', async () => {
    await scenario('baseline');
    expect((await engineGet('/v1.43/info')).status).toBe(200);
  });
});
