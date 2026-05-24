# Tasks: observability-openobserve

## Overview

Add local-first observability using OpenObserve and OTel-compatible structured events for extension reliability and E2E chaos analysis. Keep changes non-invasive and disabled-by-default where appropriate.

## Tasks

- [x] 1. Local OpenObserve developer environment
  - [x] 1.1 Add container config for local OpenObserve
    - Create `devtools/observability/docker-compose.openobserve.yml`
    - Document ports, startup, and persistence volume behavior
    - **Depends**: —
    - **Requirements**: 1.1, 1.2, 1.3

  - [x] 1.2 Add quickstart documentation
    - Add commands for start/stop/reset and first login guidance
    - Add retention/cleanup guidance to avoid unbounded disk growth
    - **Depends**: 1.1
    - **Requirements**: NF 1.1, NF 3.1, NF 3.2

- [ ] 2. Structured schema and logger plumbing
  - [ ] 2.1 Define versioned event schema
    - Add `tests/e2e/observability/schema.ts` with `ObservabilityEventV1`
    - Add validation helper for required fields
    - **Depends**: —
    - **Requirements**: 2.1, 2.2, 2.3, NF 2.1

  - [ ] 2.2 Add E2E run logger helper
    - Add `tests/e2e/observability/runLogger.ts`
    - Emit JSON artifacts (`events.jsonl`, `summary.json`) per run
    - **Depends**: 2.1
    - **Requirements**: 4.1, 4.3, 5.3

  - [ ] 2.3 Add extension observability adapter path
    - Add a minimal structured event pathway in extension logger/reliability paths
    - Keep instrumentation failure non-fatal
    - **Depends**: 2.1
    - **Requirements**: 3.1, 3.2, 3.3

- [ ] 3. Chaos E2E integration and correlation
  - [ ] 3.1 Add instrumented chaos E2E workload
    - Create `tests/e2e/chaos-reliability.test.ts`
    - Include create/update/remove/rename/reload churn with correlation IDs
    - **Depends**: 2.2, 2.3
    - **Requirements**: 4.1, 4.2

  - [ ] 3.2 Validate schema and run summary in tests
    - Assert required fields and anomaly summary generation
    - **Depends**: 3.1
    - **Requirements**: 2.1, 4.3, NF 2.2

- [ ] 4. Analysis query pack
  - [ ] 4.1 Add baseline saved queries
    - Add queries/docs for duplicates, dropped syncs, retry exhaustion, latency outliers
    - **Depends**: 1.2, 3.1
    - **Requirements**: 5.1, 5.3

  - [ ] 4.2 Add triage playbook
    - Document minimal failure triage sequence using saved queries
    - **Depends**: 4.1
    - **Requirements**: 5.2

- [ ] 5. Verification tasks
  - [ ] 5.1 Write property test for schema robustness (Property 1)
    - Randomized event payload validation for required fields and versioning
    - **Depends**: 2.1
    - **Properties**: 1

  - [ ] 5.2 Write fault-injection test for non-interference (Property 2)
    - Force logger/ingest failures; assert sync behavior remains intact
    - **Depends**: 2.3
    - **Properties**: 2

  - [ ] 5.3 E2E queryability proof task (Property 3)
    - Use a run fixture and baseline queries; verify anomalies are discoverable without custom parser code
    - **Depends**: 3.2, 4.1
    - **Properties**: 3

## Notes

- Keep default instrumentation low-noise.
- Prefer deterministic IDs in tests for reproducible analysis.
- Start with event logs, then layer deeper tracing only where needed.
