# Coverage Matrix

This is the living index for journey and fixture coverage. Task completion status belongs only in [`../specs/055-playwright-workload/tasks.md`](../specs/055-playwright-workload/tasks.md); this document records intended coverage and must be updated whenever a route group, permission, table lifecycle, importer, or user journey changes.

## User-facing route areas

| Area | Main user journeys | Roles and assertions |
| --- | --- | --- |
| Authentication | Login, logout, session lookup, registration disabled/enabled, admin-generated reset, OIDC settings, successful Dex callback, callback/token failure | Anonymous, Viewer, Admin |
| Dashboard and search | Load overview, empty/populated state, search and navigation | All roles; safe loading/error states |
| Digital Products | List, create, edit, history, import/bootstrap, retire/delete where allowed, ownership and dependencies | Viewer read-only; Editor authoring; Admin |
| Components | List/detail/history, create/edit/retire, first instance recovery, platform promotion, dependents | Viewer read-only; Editor writes; Admin |
| Component Groups | List/detail and supported create/edit/delete lifecycle | Viewer read-only; Editor/Admin write |
| Suggestions | Pending and decided views, accept/dismiss, offset/limit boundaries | Viewer read-only; Editor/Admin decisions |
| Importers and runs | Configure, edit, trigger, cancel, inspect run summary/errors/changes | Viewer read-only; Editor run actions; Admin configuration |
| Sources | Inspect Source and memberships; retire/reactivate supported lifecycle | Roles according to existing route permissions |
| Credentials | Create, update, test, delete, write-only secret handling | Admin-only writes; Viewer/Editor denied |
| Docker targets | Create/update/test/enable/disable/delete local mTLS target | Admin-only writes |
| Import Agents | Create/enroll, connect, inspect session, revoke; offline state | Admin-only administration; status readable per route |
| URL Checks | Composite create, edit, delete, enable, first-instance recovery, target/window/auth, observations/metrics | Viewer read-only; Editor ordinary check/Hub setup; Admin Credential/Agent selection |
| Organization | Lines of Business, Teams, Users; ownership assignment | Admin-only user/org writes where required |
| Sessions and activity | Session listing/revoke and audit/activity list/offset boundaries | Session ownership and Admin rules; safe audit fields |
| Settings | Profile, appearance, security, notifications, workspace, authentication, session policy, advanced | All role gates and error/empty states |

Route source of truth: `docs/ux.md`, `packages/frontend/src/ux/app/routes.tsx`, `docs/openapi.yaml`, and route permission definitions. Update this matrix when those sources gain a user-facing area.

## Role and URL Check assertions

| Operation | Viewer | Editor | Admin |
| --- | --- | --- | --- |
| Read supported catalog and monitoring views | Allowed | Allowed | Allowed |
| Create ordinary URL Checks and Hub setup | Denied | Allowed | Allowed |
| Select/change a non-null Credential reference or authentication config | Denied | Denied | Allowed |
| Preserve an existing Credential while editing unrelated fields | Denied | Allowed if unchanged | Allowed |
| Configure/reselect Agent vantage or Agent ID | Denied | Denied | Allowed |
| Preserve existing Agent setup while changing unrelated cadence | Denied | Allowed if unchanged | Allowed |
| Switch existing Agent setup back to Hub and clear Agent ID | Denied | Allowed | Allowed |
| Add first Component Instance to active zero-instance Component | Denied | Allowed | Allowed |
| Add a second instance through the focused recovery endpoint | Rejected | Rejected with conflict | Rejected with conflict |

URL Check authentication modes in the current UI are NONE, BASIC, BEARER, and CUSTOM_HEADERS. Validate key-name rules, reserved `Authorization` behavior, API-only controls, availability target/window, enabled state, no secret values in outputs, and the current Editor preserve-versus-reconfigure behavior.

The 054 URL Check onboarding branch also establishes these cases: unauthenticated 401, missing Component 404, invalid input 400, Viewer denial 403, inactive/retired parent denial, successful first instance, duplicate-instance conflict, Editor preserve-vs-reconfigure, and Editor Agent-to-Hub clearing.

## Pagination

The backend supports server-side pagination only on:

| Endpoint | Contract | Fixture boundary | Browser behavior |
| --- | --- | --- | --- |
| `GET /api/v1/components` | `page` default 1, `pageSize` default 50, maximum 100 | 201 Components covers two full 100-row UI fetches plus a partial third; request-context checks cover the default 50-row API pages | The current hook fetches all pages; verify the full rendered set, not pagination buttons |
| `GET /api/v1/audit/activity` | `limit` default 50, maximum 200; `offset` default 0 | 101 activity rows | Request-context boundary assertions; UI behavior only where a visible control exists |
| `GET /api/v1/suggestions` | `limit` default 50, maximum 200; `offset` default 0 | 101 Suggestions | Request-context boundary assertions; UI behavior only where a visible control exists |

All other current list routes are unpaginated or client-filtered. Do not add fictitious page controls to test them.

## Implemented importer matrix

| Importer | Status | Local mock | Required mapping and scenarios | Reconciliation role |
| --- | --- | --- | --- | --- |
| GitHub | Implemented | HTTPS REST mock at configurable base URL | Org and repo discovery, Link pagination, billing/capability calls, releases, environments, workflows, runners, packages; normal, empty, changed, omitted, 403/404 fallback, capability errors, 5xx run failure | Representative full add/update/omit/retire and shared-Source lifecycle |
| Alibaba Cloud | Implemented | RPC mocks for fixed STS/BSS hosts and configurable Resource Center endpoint | GetCallerIdentity; Resource Center service/count/search/configuration operations; BSS DescribeInstanceBill; action/version/request/auth field checks; success, empty, NextToken, malformed/error response | Provider mapping/contract; shared core lifecycle covered by GitHub |
| Docker | Implemented | mTLS fake Docker Engine API, no host socket | `/info`, `/version`, containers list/inspect, images, and Swarm endpoints at API v1.41+ | Provider mapping/contract; no host Docker state |
| Web URL | Implemented | Internal HTTP response fixture | One GET and status-to-asset behavior; success with empty text, non-success status, timeout/failure | Provider mapping/contract |
| API URL | Implemented | Internal JSON fixture | One GET and JSON-to-asset behavior; valid/empty JSON, changed payload, malformed body, and error response | Provider mapping/contract |
| AWS | Scaffold | None | Add to matrix when real external behavior ships | Deferred |
| Azure | Scaffold | None | Add to matrix when real external behavior ships | Deferred |
| Kubernetes | Scaffold | None | Add to matrix when real external behavior ships | Deferred |
| MCP Server | Scaffold | None | Add to matrix when real external behavior ships | Deferred |

An automated coverage guard should compare the current importer registry/manifests with this matrix and fail when a newly implemented importer has no mock/test mapping. Scaffold status is explicit and must not count as implemented coverage.

## Future-change rule

When a feature adds or changes a user-facing module, role rule, data lifecycle, importer behavior, URL Check behavior, or mock endpoint:

1. Update this matrix and the relevant fixture/mock contract in the same feature branch.
2. Add or update the Playwright journey and reference to the feature's authoritative docs/spec.
3. Add an importer mapping entry and test whenever importer behavior stops being scaffolded.
4. Keep unsupported actions explicitly marked as unsupported; do not invent delete/pagination behavior.
5. Review generated reports for secrets before retaining failure evidence.
