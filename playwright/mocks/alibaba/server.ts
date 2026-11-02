import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, env } from '../lib/mock.js';

// Alibaba RPC mock — STS GetCallerIdentity, Resource Center
// (GetResourceCenterServiceStatus / GetResourceCounts / SearchResources /
// GetResourceConfiguration), BSS DescribeInstanceBill.
// Validates Action/Version/request shape and presence of auth fields —
// never cryptographic signatures, since credentials are synthetic.
// Scenarios: baseline | empty | service-disabled | multi-page | error.

const SCENARIOS = ['baseline', 'empty', 'service-disabled', 'multi-page', 'error'] as const;
type Scenario = (typeof SCENARIOS)[number];
const store = makeScenarioStore([...SCENARIOS], 'baseline');
const log = new RequestLog();

const RESOURCES = [
  { resourceId: 'i-pw001', resourceType: 'ACS::ECS::Instance', resourceName: 'pw-web-1', regionId: 'us-east-1', arn: 'acs:ecs:us-east-1:123456789012:instance/i-pw001', accountId: '123456789012', createTime: '2026-01-01T00:00:00Z', tags: [{ key: 'env', value: 'prod' }] },
  { resourceId: 'bucket-pw', resourceType: 'ACS::OSS::Bucket', resourceName: 'pw-assets', regionId: 'us-east-1', arn: 'acs:oss:us-east-1:123456789012:bucket-pw', accountId: '123456789012', createTime: '2026-01-01T00:00:00Z' },
];

function parseRpc(reqBody: string): URLSearchParams {
  const form = new URLSearchParams(reqBody);
  if (form.get('Action')) return form;
  // Darabonba SDKs may send a JSON body — normalize it into the same lookup.
  try {
    const parsed = JSON.parse(reqBody) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== null && v !== undefined) params.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    return params;
  } catch {
    return form;
  }
}

function missingAuth(params: URLSearchParams, headers: import('node:http').IncomingHttpHeaders): string | null {
  // ACS3 header-signing scheme (newer Darabonba SDKs): authorization carries
  // Credential/SignedHeaders/Signature; nonce+date are x-acs-* headers.
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('ACS')) {
    if (!headers['x-acs-signature-nonce']) return 'x-acs-signature-nonce';
    if (!headers['x-acs-date']) return 'x-acs-date';
    if (!auth.includes('Credential=')) return 'Credential';
    return null;
  }
  for (const k of ['AccessKeyId', 'Signature', 'SignatureMethod', 'SignatureNonce', 'Timestamp', 'SignatureVersion']) {
    if (!params.get(k)) return k;
  }
  return null;
}

function acsError(res: import('node:http').ServerResponse, status: number, code: string, message: string) {
  return json(res, status, { Code: code, Message: message, RequestId: 'pw-mock-req' });
}

const server = startDataServer({
  port: Number(env('MOCK_PORT', '9443')),
  tls: { certPath: env('MOCK_TLS_CERT'), keyPath: env('MOCK_TLS_KEY') },
  handler: (req, body, res) => {
    const url = new URL(req.url ?? '/', 'https://x');
    const params = url.search ? url.searchParams : parseRpc(body);
    const action = params.get('Action') ?? (req.headers['x-acs-action'] as string | undefined) ?? '';
    const version = params.get('Version') ?? (req.headers['x-acs-version'] as string | undefined) ?? '';
    log.add({ method: req.method ?? 'POST', path: url.pathname, action, scenario: store.current });
    const s: Scenario = store.current;

    const miss = missingAuth(params, req.headers);
    if (miss) return acsError(res, 400, 'IncompleteSignature', `missing ${miss}`);
    if (s === 'error') return acsError(res, 500, 'InternalError', 'mock provider error');

    switch (action) {
      case 'GetCallerIdentity':
        if (version !== '2015-04-01') return acsError(res, 400, 'InvalidVersion', 'expected 2015-04-01');
        return json(res, 200, {
          AccountId: '123456789012', Arn: 'acs:ram::123456789012:user/pw',
          IdentityType: 'RAMUser', PrincipalId: 'pw-principal', RequestId: 'pw-req', UserId: 'pw-user',
        });

      case 'GetResourceCenterServiceStatus':
        if (s === 'service-disabled') {
          return json(res, 200, { ServiceStatus: 'Disabled', InitialStatus: 'Disabled', RequestId: 'pw-req' });
        }
        return json(res, 200, { ServiceStatus: 'Enabled', InitialStatus: 'Enabled', RequestId: 'pw-req' });

      case 'GetResourceCounts': {
        const items = s === 'empty' ? [] : RESOURCES.map((r) => ({ GroupName: r.resourceType, Count: 1 }));
        return json(res, 200, { RequestId: 'pw-req', ResourceCounts: items });
      }

      case 'SearchResources': {
        const next = params.get('NextToken');
        if (s === 'empty') return json(res, 200, { RequestId: 'pw-req', Resources: [], MaxResults: 20 });
        if (s === 'multi-page' && !next) {
          return json(res, 200, { RequestId: 'pw-req', MaxResults: 1, NextToken: 'page2', Resources: [RESOURCES[0]] });
        }
        if (s === 'multi-page' && next === 'page2') {
          return json(res, 200, { RequestId: 'pw-req', MaxResults: 1, Resources: [RESOURCES[1]] });
        }
        return json(res, 200, { RequestId: 'pw-req', MaxResults: 20, Resources: RESOURCES });
      }

      case 'GetResourceConfiguration': {
        const id = params.get('ResourceId');
        const r = RESOURCES.find((x) => x.resourceId === id);
        if (!r) return acsError(res, 404, 'ResourceNotFound', `no ${id}`);
        return json(res, 200, {
          RequestId: 'pw-req', ResourceId: r.resourceId, ResourceType: r.resourceType,
          ResourceName: r.resourceName, RegionId: r.regionId,
          Configuration: JSON.stringify({ status: 'Running', synthetic: true }),
        });
      }

      case 'DescribeInstanceBill': {
        const next = params.get('NextToken');
        if (s === 'empty') {
          return json(res, 200, { RequestId: 'pw-req', Success: true, Code: 'SUCCESS', Data: { Items: [], TotalCount: 0 } });
        }
        if (s === 'multi-page' && !next) {
          return json(res, 200, { RequestId: 'pw-req', Success: true, Code: 'SUCCESS', Data: { TotalCount: 2, NextToken: 'b2', Items: [{ InstanceID: 'i-pw001', PretaxAmount: 1.5, PretaxGrossAmount: 1.5, Currency: 'USD', ProductName: 'ECS' }] } });
        }
        if (s === 'multi-page' && next === 'b2') {
          return json(res, 200, { RequestId: 'pw-req', Success: true, Code: 'SUCCESS', Data: { TotalCount: 2, Items: [{ InstanceID: 'bucket-pw', PretaxAmount: 0.25, PretaxGrossAmount: 0.25, Currency: 'USD', ProductName: 'OSS' }] } });
        }
        return json(res, 200, {
          RequestId: 'pw-req', Success: true, Code: 'SUCCESS',
          Data: {
            TotalCount: 2,
            Items: [
              { InstanceID: 'i-pw001', PretaxAmount: 1.5, PretaxGrossAmount: 1.5, Currency: 'USD', ProductName: 'ECS' },
              { InstanceID: 'bucket-pw', PretaxAmount: 0.25, PretaxGrossAmount: 0.25, Currency: 'USD', ProductName: 'OSS' },
            ],
          },
        });
      }

      default:
        return acsError(res, 400, 'InvalidAction', `mock-alibaba: unrecognized action "${action}"`);
    }
  },
});

const control = startControlServer(Number(env('MOCK_CONTROL_PORT', '9444')), {
  getScenario: () => store.current,
  setScenario: (name) => {
    if (!(SCENARIOS as readonly string[]).includes(name)) return false;
    store.current = name as Scenario;
    return true;
  },
  scenarios: () => [...SCENARIOS],
  log,
});

console.log(`alibaba mock https :${env('MOCK_PORT', '9443')} control :${env('MOCK_CONTROL_PORT', '9444')}`);
void server; void control;
