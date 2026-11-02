import { test, expect } from '@playwright/test';

const CTL = 'http://mock-control:9090';
const ALI = 'https://mock-alibaba';
const STS = 'https://sts.aliyuncs.com';
const BSS = 'https://business.aliyuncs.com';

const rpc = (params: Record<string, string>) => new URLSearchParams({
  Format: 'JSON', AccessKeyId: 'AK', Signature: 's', SignatureMethod: 'HMAC-SHA1',
  SignatureNonce: 'n', SignatureVersion: '1.0', Timestamp: new Date().toISOString(), ...params,
}).toString();

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-alibaba`, { method: 'POST', body: JSON.stringify({ name }) });
}

test.describe('alibaba mock contracts', () => {
  test('STS GetCallerIdentity validates action/version/auth fields', async () => {
    const ok = await fetch(`${STS}/`, { method: 'POST', body: rpc({ Action: 'GetCallerIdentity', Version: '2015-04-01' }) });
    expect((await ok.json()).AccountId).toBe('123456789012');

    const badVersion = await fetch(`${STS}/`, { method: 'POST', body: rpc({ Action: 'GetCallerIdentity', Version: '1900-01-01' }) });
    expect(badVersion.status).toBe(400);
  });

  test('missing auth fields fail closed', async () => {
    const res = await fetch(`${STS}/`, { method: 'POST', body: new URLSearchParams({ Action: 'GetCallerIdentity' }).toString() });
    expect(res.status).toBe(400);
    expect((await res.json()).Code).toBe('IncompleteSignature');
  });

  test('Resource Center SearchResources supports NextToken paging and empty', async () => {
    await scenario('multi-page');
    const p1 = await (await fetch(`${ALI}/`, { method: 'POST', body: rpc({ Action: 'SearchResources', Version: '2022-12-01', MaxResults: '1' }) })).json();
    expect(p1.NextToken).toBe('page2');
    const p2 = await (await fetch(`${ALI}/`, { method: 'POST', body: rpc({ Action: 'SearchResources', Version: '2022-12-01', NextToken: 'page2' }) })).json();
    expect(p2.Resources).toHaveLength(1);
    expect(p2.NextToken).toBeUndefined();

    await scenario('empty');
    const e = await (await fetch(`${ALI}/`, { method: 'POST', body: rpc({ Action: 'SearchResources', Version: '2022-12-01' }) })).json();
    expect(e.Resources).toHaveLength(0);
  });

  test('service-disabled and BSS billing scenarios', async () => {
    await scenario('service-disabled');
    const s = await (await fetch(`${ALI}/`, { method: 'POST', body: rpc({ Action: 'GetResourceCenterServiceStatus', Version: '2022-12-01' }) })).json();
    expect(s.ServiceStatus).toBe('Disabled');

    await scenario('baseline');
    const bill = await (await fetch(`${BSS}/`, { method: 'POST', body: rpc({ Action: 'DescribeInstanceBill', Version: '2017-12-14', BillingCycle: '2026-10' }) })).json();
    expect(bill.Data.Items.length).toBeGreaterThan(0);
  });

  test('unrecognized RPC action fails closed', async () => {
    const res = await fetch(`${ALI}/`, { method: 'POST', body: rpc({ Action: 'NukeEverything', Version: '2022-12-01' }) });
    expect(res.status).toBe(400);
  });
});
