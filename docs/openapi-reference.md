---
title: OpenAPI reference
description: Interactive OpenAPI 3.0 reference for the Componode API.
---

# OpenAPI Reference

This page renders the OpenAPI 3.0 specification for the Componode API. It is generated from the same source as [`docs/openapi.yaml`](./openapi.yaml).

<script setup>
import spec from './openapi.yaml?raw'
</script>

<OASpec :spec="spec" group-by-tags :hide-branding="true" />
