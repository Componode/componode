---
"@componode/frontend": patch
---

Fix horizontal page overflow at narrow viewports (#298): the detail-page tab bar (`TabsList`) is now capped at its container width and scrolls internally when the tab row is too wide — previously it extended past the viewport at exactly 768px (iPad portrait), causing an 18px horizontal page scroll.
