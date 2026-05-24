# Requirements Document

## Introduction

The project needs local-first observability for reliability and chaos testing without relying on external SaaS. This spec introduces a self-hosted OpenObserve setup and structured instrumentation for both the extension service worker and E2E tests, so failures can be analyzed quickly by humans and AI.

## Glossary

- **OpenObserve**: Self-hosted observability backend used for logs and traces
- **OTel-Compatible Event**: Structured event fields that align with OpenTelemetry conventions (`trace_id`, `span_id`, severity, attributes)
- **Run_ID**: Unique ID assigned to one E2E/chaos run for end-to-end correlation
- **Chaos_Workload**: High-churn E2E scenario with create/update/remove/rename/reload behavior

## Requirements

### Requirement 1: Local OpenObserve Environment

**User Story:** As a developer, I want observability running locally in a container, so I can inspect reliability runs without external services.

#### Acceptance Criteria

1. WHEN a developer starts the observability stack, THE project SHALL run OpenObserve locally via container configuration checked into the repository
2. WHEN OpenObserve starts, THE project SHALL expose a documented local URL and default credentials setup instructions
3. WHEN the local stack is stopped/restarted, THE project SHALL preserve logs for the current session unless explicitly cleared

### Requirement 2: Structured, Queryable Event Schema

**User Story:** As a developer, I want a stable event schema, so I can query and compare runs without ad-hoc parsing scripts.

#### Acceptance Criteria

1. WHEN instrumentation emits events, THE system SHALL include required correlation fields (`run_id`, `trace_id`, `scenario`, `event_type`, `timestamp`)
2. WHEN an operation targets sync entities, THE system SHALL include contextual identifiers (`group_name`, `group_id`, `folder_id`) when available
3. WHEN an error occurs, THE system SHALL include normalized error fields (`error_name`, `error_message`, `error_code`) and operation status
4. WHEN events are sent to OpenObserve, THE project SHALL use OpenObserve-supported ingestion/logging libraries or APIs as the default integration path (instead of ad-hoc one-off parsers)

### Requirement 3: Extension-Side Instrumentation

**User Story:** As a developer, I want service worker and sync engine events captured with minimal overhead, so I can diagnose reliability issues in production-like flows.

#### Acceptance Criteria

1. WHEN key reliability paths execute (initialization, alarm wake, queue processing, folder resolution, retries), THE extension SHALL emit structured events to a shared logger interface
2. WHEN instrumentation is disabled by config, THE extension SHALL continue normal functionality with negligible runtime overhead
3. WHEN events are emitted, THE logger SHALL avoid introducing new failure modes in sync-critical paths
4. WHEN extension/test emitters are implemented, THE integration SHALL remain compatible with OpenObserve-native ingestion expectations for field structure and transport

### Requirement 4: E2E Chaos Instrumentation and Correlation

**User Story:** As a developer, I want chaos workloads to emit rich run artifacts, so I can correlate test actions with extension behavior.

#### Acceptance Criteria

1. WHEN chaos E2E tests run, THE test harness SHALL assign a `run_id` and emit structured step events
2. WHEN test steps trigger extension activity, THE harness SHALL propagate correlation context so extension events can be tied to the same run
3. WHEN a chaos run completes, THE harness SHALL produce a summary artifact with pass/fail counts, anomaly counts, and top error signatures

### Requirement 5: Reusable Analysis Queries

**User Story:** As a developer, I want predefined analysis queries, so I can investigate failures quickly without writing custom parsing code.

#### Acceptance Criteria

1. THE repository SHALL include a documented set of baseline queries for duplicate-folder detection, dropped syncs, retry exhaustion, and long-latency operations
2. WHEN a run fails, THE workflow SHALL point to a minimal triage sequence using those baseline queries
3. WHEN run comparisons are needed, THE workflow SHALL support filtering by `run_id` and scenario labels

## Non-Functional

**NF 1: Usability**

1. A new contributor SHALL be able to start observability locally and run one instrumented chaos test within 15 minutes using documented commands

**NF 2: Data Quality**

1. Observability events SHALL use a versioned schema to avoid drift
2. Required fields SHALL be validated in tests for at least one chaos scenario

**NF 3: Safety and Cost**

1. Local defaults SHALL avoid unbounded disk growth (retention/cleanup guidance required)
2. No external telemetry SaaS SHALL be required for core workflow

## Out of Scope

- Production-hosted observability infrastructure
- Advanced distributed tracing across third-party services
- Replacing existing extension functional logic unrelated to observability
