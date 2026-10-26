---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
---

Self-service profile update (spec `030-self-service-profile`, gap G14): `PATCH /users/me` bound to the session user behind a strict `updateSelfSchema` (`displayName` + `email` only).
