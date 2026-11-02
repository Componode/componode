import { test, expect } from '@playwright/test';
import { lookup } from 'node:dns/promises';

const isPrivateIp = (ip: string) =>
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);

test.describe('runtime network isolation', () => {
  test('fixed provider hostnames resolve to internal mock addresses', async () => {
    for (const host of ['sts.aliyuncs.com', 'business.aliyuncs.com']) {
      const { address } = await lookup(host);
      expect(isPrivateIp(address), `${host} → ${address}`).toBeTruthy();
    }
  });

  test('mock service names resolve internally', async () => {
    for (const host of ['mock-github', 'mock-alibaba', 'mock-docker-engine', 'probe.target.test', 'app.componode-pw.test']) {
      const { address } = await lookup(host);
      expect(isPrivateIp(address), `${host} → ${address}`).toBeTruthy();
    }
  });

  test('outbound egress to real provider endpoints is impossible', async () => {
    // No route off the internal network — fetch must fail, never fall through.
    await expect(
      fetch('https://api.github.com/rate_limit', { signal: AbortSignal.timeout(8000) }),
    ).rejects.toThrow();
    await expect(
      fetch('https://ecs.aliyuncs.com/', { signal: AbortSignal.timeout(8000) }),
    ).rejects.toThrow();
  });
});
