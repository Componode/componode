### ADR-093 — TLS / HTTPS for production

> **Status:** Ratified

**Context**: Without TLS, the session cookie, OIDC authorization code flow,
and API responses are transmitted in plaintext.

**Decision**: **Production MUST use HTTPS. Componode does not terminate TLS
— TLS is terminated by the deployer's reverse proxy (nginx, Caddy, Traefik,
or cloud LB).** The backend sets `Strict-Transport-Security` in production
([ADR-089](./ADR-089-security-headers.md)) and configures `trustProxy` to the proxy's IP (via
`TRUSTED_PROXY_IP` env var, not `true`) to trust `X-Forwarded-Proto`/
`X-Forwarded-Host` without allowing client spoofing. `docs/deployment.md`
documents TLS setup for Caddy (automatic Let's Encrypt) and nginx
(manual/explicit). The example `docker-compose.yml` includes a commented-
out Caddy service. Dev runs over HTTP (no TLS required).

**Rationale**: In-app TLS termination pushes cert management into the app
(the proxy's job). `trustProxy` to proxy IP (not `true`) prevents client
spoofing of `X-Forwarded-Proto`. Two proxy options documented (neutral, not
opinionated). Dev is HTTP (localhost is not a sniffing risk).

**Amendment (2026-09-10 security assessment)**: Implemented. `TRUSTED_PROXY_IP`
accepts a single proxy IP, a comma-separated list of proxy IPs, or an integer
hop count; unset means `trustProxy: false` and `X-Forwarded-*` headers are
ignored entirely. Previously the code unconditionally set `trustProxy: true`,
which let any client spoof `X-Forwarded-For` to bypass IP-keyed rate limiting.

**Amendment (2026-09-21 docs review)**: `docs/deployment.md` now documents
Caddy and nginx TLS setup as decided, and `docker-compose.yml` includes the
commented-out Caddy service this decision promised.

**Amendment (2026-10-22)**: The commented-out Caddy service is promoted to
an enabled, bundled front end. A shipped `Caddyfile` uses `tls internal` —
the certificate is issued by Caddy's internal CA (self-signed), so
deployments get HTTPS without a public CA; removing `tls internal` restores
the automatic Let's Encrypt path for public `SITE_ADDRESS` values. The
app's published port is bound to `127.0.0.1` so remote plaintext access is
not possible, and the Compose stack defaults `TRUSTED_PROXY_IP=1` (one
trusted hop — the bundled proxy) instead of leaving it unset. The Caddy
container carries a fixed `hub` network alias so the co-located `agent`
service (ADR-028 Amendment 1) has a stable TLS name; the agent mounts the
`caddy_data` volume read-only and sets `CA_BUNDLE` to the internal root CA
(`/data/caddy/pki/authorities/local/root.crt`), preserving the fail-closed
TLS posture for non-loopback `HUB_URL` values.