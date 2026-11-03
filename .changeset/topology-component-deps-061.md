---
"@componode/frontend": patch
---

Product topology now shows direct Component `DEPENDS_ON` targets in a "Depends on components" lane (spec 061, ADR-127 Amendment 2) — a product whose only relations are component dependencies no longer renders a false "No relationships yet" empty map. Component nodes carry operational status, inspection, `+N` expansion, and Open-component navigation; group-mediated and `COMPOSES`-inherited components stay out of the lane.
