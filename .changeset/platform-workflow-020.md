---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
---

Guided Platform Product workflow (spec `020-platform-product-workflow`, ADR-017): shared components stop being invisible — Componode detects them and turns them into governed platform products.

- `GET /components/platform-candidates` lists active components with direct `DEPENDS_ON` edges from two or more active products, naming the dependent products (group-reach doesn't count — direct edges only).
- `POST /components/{id}/promote-to-platform` creates the `PLATFORM` product, wires its own `DEPENDS_ON` edge, and rewrites chosen consumers to `CONSUMES_FROM` — one atomic transaction, all-or-nothing. Consumers can be individually opted out and keep their direct edge.
- The dashboard gains a **Platform candidates** worklist, and every active component's detail page offers **Promote to platform** — promotion works even with zero consumers.
