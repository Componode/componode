# Componode Documentation

Welcome to the Componode documentation. Componode is an open-source, self-hosted Digital Product Asset Management (DPAM) platform.

## What is Componode?

Componode helps you model your **Digital Products** — applications, solutions, platforms — as compositions of building-block **Components** imported from repository tools, cloud environments, container orchestrators, and web/API/MCP endpoints.

## Key concepts

- **Digital Product** — a business capability or customer-facing solution.
- **Component** — a shared building block (e.g., a service, database, compute instance).
- **Component Instance** — a deployed occurrence of a component in a specific environment.
- **Importer** — a pull-only connector that discovers assets and returns `AsyncGenerator<DiscoveredAsset>`.

## Getting started

- [Deploy with Docker Compose](deployment.md)
- [Release process](release.md)
- [Roadmap](roadmap.md)

## Reference

- [Digital products & composition](digital-products.md)
- [Architecture overview](architecture.md)
- [API reference](api.md)
- [OpenAPI reference](openapi-reference.md)
- [UX/UI reference](ux.md)
- [Importer development](importer-development.md)
