# CI Speed Engineering Research

> **Purpose**: Quantify and design the optimization of the CI feedback loop —
> the `check` and `e2e` gates on develop PRs currently cost ~25–30 minutes
> wall clock each, which the team correctly identifies as a development-
> velocity problem now that both are required checks (spec 084).
>
> **Scope**: Speed engineering only. The gate semantics themselves — full
> e2e required on every develop PR — are **not** up for renegotiation in
> this document; the design review that motivated it concluded that
> impact-based test selection is technically unsafe for this suite and that
> promotion-only testing violates the compliance-invariant of the two-branch
> model. Those rejections are recorded here with their reasoning so the
> grilling session can challenge them with evidence rather than rediscovery.
>
> **Relationship to existing work**: Follows spec 084 (two-branch release
> strategy, which made `e2e` a required check) and issue #294 (first-ever
> CI e2e runs exposing latent suite defects — the debugging loop that
> quantified how painful slow CI iterations are).

---

## Executive Summary

1. **The pain is real but misattributed**: the cost is not "the whole suite
   runs" — it is that the suite runs **serially on one worker, after
   uncached multi-image builds, inside a monorepo job with no dependency
   caching**. Every dominant factor is a one-time engineering fix.
2. **`workers: 1` is a deliberate design constraint**, not an oversight:
   the suite shares mutable seeded state (one database, mock control-plane
   scenarios) and parallel workers inside one stack would race. Naive
   parallelism is therefore impossible — but sharding across **independent
   stacks** (one compose project per shard job) is not, because the shared-
   state constraint is per-stack, not per-suite.
3. **Realistic target: full e2e ≤ 10 minutes wall clock** (4 shards ×
   ~5 min + ~2 min cached setup) and `check` ≤ 5 minutes, without weakening
   any coverage. At that latency, with zero required approvals and
   auto-merge on develop, the gate cost approaches invisibility.
4. **The repo's usage pattern amplifies the payoff**: AI agents iterate on
   CI heavily (the 084/#294 work alone burned ~10 full cycles in two days);
   every minute shaved per cycle returns hours per month.

## Measured Baseline (GitHub-hosted ubuntu-latest, 2-core/4-core runners)

Evidence runs: 45808033386-era jobs on PRs #293/#295.

| Stage | Duration | Notes |
|---|---|---|
| `check` job total | 21–30 min | lint + typecheck + unit tests + build + audit + generated-doc checks across the monorepo, no turbo/pnpm cache in CI |
| `e2e` job total | 24–26 min | first-ever run 24m20s; registry-fixed run similar |
| — of which image builds | ~4–8 min | **10 compose images** built per run (app, agent, runner, mocks×N, dex deps), zero layer caching today |
| — of which suite execution | 16–20 min | ~385 tests, `workers: 1`, `fullyParallel: false`, retries: 1 (failures cost double) |
| — of which stack boot/seed/enroll | ~2–3 min | compose up + reset + seed + agent enrollment |

A full red-green iteration during #294 debugging therefore cost ~25 minutes
per experiment even for a one-line test change — the pain that motivated
this research.

## Constraint Analysis (what shapes the design space)

1. **Shared mutable state forces serial execution within a stack.** The
   playwright config states it plainly: seeded database state and mock
   scenarios are shared and mutable across the suite. Tests mutate a common
   catalog (retirement, reconciliation, BOM curation) and the mock control
   plane reprograms provider behavior mid-suite. Any design must respect
   this or pay for a test-isolation redesign (much larger scope — recorded
   as an open question, not assumed).
2. **Sharding across jobs is nonetheless viable**: each shard job on a
   separate runner spins up its *own complete isolated stack* (compose
   project names are already parameterized) and runs its slice serially.
   Isolation is by machine, not by test. Cost: 4× the stack-boot and
   image-build work per PR unless caching neutralizes it — which is why
   caching and sharding must be designed together.
3. **Public-repo economics**: GitHub-hosted minutes are free for public
   repos and concurrency is generous — the scarce resource is wall-clock
   latency, not compute. This inverts the usual cost calculus: massive
   parallelism is cheap, *serial time* is the enemy.
4. **Image rebuilds dominate setup**: compose builds bake workspace
   dependencies and source. Most PRs change neither — layer caching should
   reduce the common case to the final source-copy layers only.
5. **Retry inflation**: `retries: 1` doubles the cost of genuinely failing
   tests. Desirable for flake absorption, but it means a red suite costs
   ~2× — another reason iteration speed matters more than per-test speed.
6. **The `check` job has its own disease**: turborepo running lint/
   typecheck/test/build with no cache reuse across runs. pnpm store caching
   + turbo's local cache (or remote caching) are standard, well-understood
   fixes. Measurement is needed to apportion lint vs test vs build time —
   currently unknown.

## Candidate Optimizations (to be grilled)

### O1 — Docker layer caching for compose builds
Use `docker/buildx` cache backends (GHA cache or registry) or pre-build
and publish the stable images (mocks, runner base) to GHCR, rebuilding only
`app`/`agent` layers when source changes. Expected saving: 3–6 min per e2e
run; multiplies across shards, so it is a prerequisite for O3.

### O2 — pnpm + turbo caching for `check`
Cache the pnpm store keyed on lockfile; cache turbo artifacts keyed on
inputs. Expected: check drops from 21–30 min toward 5–10 min on typical
PRs (unchanged packages skip entirely). Requires care: audit and
generated-doc checks must remain unconditional (they are global, not
per-package).

### O3 — Playwright sharding across isolated stacks
Split chromium-desktop into N shards (start with 3–4) via `--shard`, each a
separate job with its own compose project, database, and mock set. Each
shard re-runs seed/enroll (~2–3 min overhead per shard — the fixed cost
that caps useful N). Expected: 16–20 min serial → ~6–8 min wall clock at
N=4 including per-shard overhead. Risks to grill: seed cost multiplication,
sharding imbalance (suite duration is unevenly distributed — the BOM and
journey specs dominate), whether shard splitting must be manually curated
rather than round-robin, and the runner-image build cost multiplying
without O1.

### O4 — Browser-project rationalization
`chromium-narrow` re-runs the full journey suite at a second viewport;
`firefox-smoke`/`webkit-smoke` run only `@smoke`-tagged specs. Question
for grilling: is narrow-viewport coverage load-bearing for every journey,
or should it be a curated subset (layout-critical specs tagged, e.g.
`@narrow`)? This is legitimate test-design optimization — deliberate
coverage decisions — not weakened gating. Potential saving: a large fraction
of suite time, since journeys dominate.


### O5 — Per-test duration audit and worst-offender budget
No per-test timing data has been collected. The JUnit reporter already
emits durations; harvesting the slowest 20 tests will likely show a long
tail (importer-run-dependent tests wait on real run completion). Some may
have tautological polling or fixed sleeps. Cheap, orthogonal to O1–O4.

### O6 — Merge-pipeline ergonomics (zero cost, do regardless)
Auto-merge is already enabled and approvals are zero — but the develop
workflow culture should be "fire PR, walk away". Documenting this is free.
Optionally evaluate GitHub merge queue if PR volume ever creates
semantic-conflict churn (not needed today).

## Rejected Alternatives (recorded with reasoning — challenge with evidence)

| Alternative | Why rejected |
|---|---|
| **Impact-based selective testing on PRs** | No reliable ownership mapping exists; the LIBRARY/pagination regression (#294) is the counterexample — a catalog-service filter change broke an API-contract test with no plausible tag/path link. Cross-cutting integration effects are the suite's entire purpose. Coverage-instrumented TIA is weeks of infrastructure for a solo+agents repo. |
| **Full e2e only at promotion (develop→main)** | Violates requirement #2 of the branch design (develop is where everything must be *tested and compliant* before promotion); failures surface at release time requiring N-PR bisection; the gate's value is per-merge attribution, which squash-merged single PRs provide. |
| **Post-merge full suite on develop-push (smoke on PR)** | The one honest alternative. Coherent because squash merges give exact attribution, but accepts develop-red windows that block promotions and normalizes merging-broken-code. Rejected *for now* because O1–O4 make the full gate cheap enough; remains the documented escape valve if velocity demands it. |

## Open Questions for the Grilling Session

1. Is test-isolation redesign (per-test namespaced seed data, run-scoped
   fixtures) worth its large scope as a long-term direction, or is
   shard-per-stack the permanent answer? The suite's shared-state design
   was deliberate — what exactly does it buy (realism? simplicity?) and
   what is the price tag of keeping it?
2. What is the correct shard count given per-shard seed/boot overhead, and
   does round-robin sharding imbalance badly enough to require curated
   shard assignment (by spec-file duration)?
3. Should `check` and `e2e` jobs share cache infrastructure — and does the
   e2e app-image build belong in the same cache graph as the CI build?
4. Is `chromium-narrow`'s full-journey duplication a deliberate coverage
   decision or an accident of suite growth? Who owns the `@narrow`-style
   curation if it becomes selective?
5. Where does the retry policy fit: keep `retries: 1` everywhere, or
   shard-dependent (first shard fast-fails)? Flake absorption vs feedback
   speed.
6. Should stack boot itself be optimized (healthcheck intervals, seed
   parallelization, enrollment pre-staging) — the per-shard fixed cost
   determines the sharding ceiling.
7. Is GHCR pre-publication of stable images acceptable from a supply-chain
   hygiene view (the repo already publishes release images there), or must
   everything remain hermetically built per run?
8. What are the acceptance metrics — propose: p50/p95 wall clock per job
   measured over a week, with a hard budget (e2e ≤ 10 min, check ≤ 5 min)
   enforced as a regression alarm in CI observability?

## Proposed Success Metrics

- `e2e` job wall clock p50 ≤ 10 minutes on a typical develop PR (from
  ~25 min), measured over a representative week.
- `check` job wall clock p50 ≤ 5 minutes (from 21–30 min).
- No reduction in test count, project coverage decisions excepted via the
  deliberate O4 process.
- Iteration cost (push → result) for a one-line test fix ≤ 12 minutes.
