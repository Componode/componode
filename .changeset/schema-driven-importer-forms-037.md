---
"@componode/frontend": minor
---

Schema-driven importer forms (spec `037-schema-driven-importer-forms`, gap G13): the importer create/edit form now renders typed scope controls — text/URL inputs, dropdowns, switches, list editors — generated from each importer's serialized `configSchema`, with required markers, schema defaults materialized, per-field JSON fallback for complex fields, an "Unrecognized fields" block for stored keys outside the schema, and a lossless "Edit as JSON" mode.
