---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
---

Team ↔ LOB association (spec `034-team-lob-association`, gap G12): optional `teams.lobId` (migration 021, ADR-077 Amendment 1, `ON DELETE SET NULL`); team reads embed a resolved `lob` summary and the product form groups its team picker by the selected LOB.
