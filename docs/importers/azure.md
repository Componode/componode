---
title: Azure importer
description: "Scaffold importer for Azure: what it will discover and how to configure it."
---

# Azure importer

> **Status: scaffold.** This importer registers the Azure provider and emits
> a placeholder component per configured resource type — it does **not**
> call Azure APIs yet. Use it to exercise the importer-config → run →
> catalog flow; don't expect real inventory.

## What it creates today

- One component (`COMPUTE` category, provider `AZURE`) per configured
  resource type, named `<resourceType>:<subscriptionId|default>`, with a
  synthetic instance.

## Prerequisites in Azure

**None today** — no Azure calls are made. When live discovery lands, expect
to need a Microsoft Entra app registration (client ID/secret or managed
identity) with `Reader` role on the subscription.

## Credentials

None.

## Configuration

<!-- GENERATED:contract -->
**Secrets:** none
**Execution:** hub or Import Agent
**Source identity:** `context.reportSourceIdentity()`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `subscriptionId` | string | no | — | Subscription label recorded on the placeholder asset |
| `sourceKey` | string | no | — | Fallback source identity when `subscriptionId` is absent — one of the two is required (ADR-120) |
| `resourceTypes` | string[] | no | `["Microsoft.Compute/virtualMachines"]` | ARM resource type labels; one placeholder component each |
| `endpoint` | URL | no | — | Recorded on the asset's details/url; reserved for a future real connection |
<!-- /GENERATED:contract -->


## Source identity

Identity is `subscriptionId`, falling back to `scope.sourceKey` when no
subscription is configured — one of the two is **required** or the run fails.
The placeholder `externalId`s are scoped by that identity (`{identity}:{type}`;
previously `default` when no subscription was set). Migration 023 backfills a
Source + memberships for configs that already carry a `subscriptionId`; others
adopt on their next run once `sourceKey` is set.
