# Contract: OIDC issuer validation + discovery fetch

Applies to `PUT /api/v1/settings/oidc` (`updateOidcConfig`) — admin-gated
(`oidc:configure`). Endpoint shape, permission, and error envelope are
unchanged (ADR-104: openapi.yaml updated only if descriptions change).

## Issuer acceptance matrix (evaluated before any network I/O)

| Issuer input | Result |
|---|---|
| `https://idp.example.com` | accept → discovery fetch |
| `https://idp.example.com/` (trailing slashes) | accept — normalized exactly as today |
| `http://localhost:8080` / `http://127.0.0.1:8080` / `http://[::1]:8080` | accept — loopback development IdP |
| `http://idp.internal.example` | reject — non-loopback plain HTTP |
| `ftp://idp.example.com`, `file:///etc/passwd`, `gopher://x` | reject — non-HTTP(S) scheme |
| `https://user:pass@idp.example.com` | reject — embedded credentials |
| `https://idp.example.com?x=1` / `…#frag` | reject — query/fragment |
| `not-a-url`, `""` | reject — unparseable (schema already guards `enabled && !issuer`) |

Rejection shape: `422` `{ code: "OIDC_DISCOVERY_FAILED", message }` — the
same code discovery failures already return. Message names the constraint
("issuer must use https", "credentials are not allowed in the issuer URL")
and contains no resolved-IP or stack detail.

## Discovery fetch invariants (unchanged + new bound)

- Timeout: `AbortSignal.timeout(5000)` — unchanged.
- URL fetched: `{normalizedIssuer}/.well-known/openid-configuration` — unchanged.
- NEW: response body capped at 64 KiB — `content-length` over the cap or a
  streamed body over the cap fails with `OIDC_DISCOVERY_FAILED`.
- Response must be 2xx and JSON-parseable — unchanged.

## Trust-boundary note

The login-time fetch in `oidc-service.ts` (`client.discovery`) reads only the
*stored* issuer. Since `updateOidcConfig` is the sole write path, every
persisted issuer has passed this matrix — no additional check is needed on
the read path.
