# Quickstart: validating guided Docker importer setup

Prerequisites: repo built (`pnpm install && pnpm build`), a Docker Engine
reachable from the Hub (for the socket path, the documented compose mount
from `docs/deployment.md` → *Docker importer on the Hub*), and an admin
login.

## 1. Probe endpoint (backend)

```bash
# From packages/backend, against a running hub:
curl -s -X POST http://localhost:3000/api/v1/docker-targets/probe \
  -H 'content-type: application/json' -b 'session=…' \
  -d '{"profile":{"transport":"socket","path":"/var/run/docker.sock"}}'
# → {"ok":true}

# Secret-requiring profile, inline secrets:
curl -s -X POST …/docker-targets/probe -d '{
  "profile":{"transport":"tcp","host":"docker.example.com","port":2376,
             "clientCertKey":"clientCert","clientKeyKey":"clientKey"},
  "secrets":{"clientCert":"…","clientKey":"…"}}'
# → {"ok":true} or {"ok":false,"error":"<sanitized>"}

# Reused credential (no secret values in the request):
curl -s -X POST …/docker-targets/probe -d '{
  "profile":{…},"credentialId":"<credential uuid>"}'
```

Expected: `ok:true` against a reachable engine; `ok:false` with a
sanitized reason otherwise; `400 VALIDATION_FAILED` for malformed
profiles — all before any record exists. Verify zero rows in
`docker_targets`/`credentials`/`importer_configs` after probing.

## 2. Wizard flow (frontend)

1. Sign in as ADMIN → **Sources → Importers → Guided setup** (or the hint
   on *Add importer* with Docker selected).
2. Pick **Local socket / named pipe**, enter `/var/run/docker.sock`.
3. Identity step: label `Local Docker`, suggested selector editable,
   schedule preset, enabled on.
4. **Test connection** → success enables **Create importer**.
5. Create → lands on the new importer detail → **Run now** → components
   appear under the catalog.

Repeat for `tcp`/`ssh` to exercise the secrets step: paste PEM values →
probe → create (a STORED credential appears under **Credentials** with
canonical keys) → config links it. Pick an existing credential instead to
exercise the coverage-gated reuse path.

## 3. Progressive disclosure

Open any Docker importer config edit form → scope section shows target
picker, environment label, include-images; `environmentMap`,
`componentIdLabel`, `sourceKey` sit under **Advanced** (collapsed).
Expand, edit, save — values persist identically.

## 4. Automated checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd packages/backend && pnpm docs:api:check   # regenerated api.md in sync
cd packages/backend && pnpm docs:importers:check
cd packages/backend && pnpm docs:oracle:check && pnpm docs:sidebar:check
```

New/updated tests: backend probe integration tests
(`test/integration/docker-targets.test.ts`), contract test coverage via
`api-docs-contract.test.ts` (openapi.yaml updated), frontend unit tests
for wizard logic + scope disclosure.
