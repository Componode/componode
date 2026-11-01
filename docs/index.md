---
layout: home

hero:
  name: Componode
  text: Digital Product Asset Management
  tagline: Open-source, self-hosted catalog that models digital products as compositions of imported components.
  actions:
    - theme: brand
      text: Get started
      link: /deployment
    - theme: alt
      text: View on GitHub
      link: https://github.com/Componode/componode

features:
  - title: Learn the model
    details: Digital Products, Components, Instances, and the Composable Product Model — explained with worked examples.
    link: /digital-products
  - title: Deploy the hub
    details: One Docker Compose stack — Fastify backend, React frontend, PostgreSQL. Up in minutes.
    link: /deployment
  - title: Connect importers
    details: Pull-only importers for GitHub, Alibaba Cloud, Docker, API/Web URLs — plus Import Agents for private networks.
    link: /importers/
  - title: Explore the API
    details: Interactive OpenAPI reference covering every route under /api/v1.
    link: /openapi-reference
---

::: tip About this project
Componode is a personal learning project. It was built to explore, hands-on,
how applications are developed today with AI coding assistants — the tooling,
the workflows (spec-driven development, ADRs, changesets), and the
architecture decisions that come with a real codebase.

It was not built by a professional developer, so expect rough edges — and it
is **not a production-grade solution**. If you spot something questionable,
please [open an issue](https://github.com/Componode/componode/issues) and say
so. That's how this project gets better.
:::

## Where to go next

| I want to… | Start here |
|---|---|
| Understand what Componode models | [Digital Products in depth](./digital-products) |
| Run it locally | [Deployment](./deployment) |
| See what an importer needs | [Importers overview](./importers/) |
| Reach a private network | [Import Agents](./import-agents) |
| Call the API | [API conventions](./api) · [Interactive OpenAPI](./openapi-reference) |
| Understand how it's built | [Architecture](./architecture) · [Importer development](./importer-development) |
| See what's next | [Roadmap](./roadmap) |
