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