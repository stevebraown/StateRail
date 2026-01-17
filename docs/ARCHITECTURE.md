# StateRail Architecture & Implementation Plan

## Scope
- Visual workflow orchestration with predictable state machines, event-first analytics, and rich operator feedback.
- Stack: React + TypeScript (D3/React Flow), Node.js GraphQL BFF, Rust workflow engine, Kafka/Redpanda (or NATS), Postgres, optional ClickHouse/Timescale for analytics.

## System Overview
- **Frontend (React/TS)**: builder, run views, live graph, analytics, alerts; GraphQL over HTTP/WS.
- **GraphQL BFF (Node)**: schema for workflows/runs/events/metrics/alerts; talks to Rust engine (gRPC/HTTP), Postgres, analytics service; bridges event stream to subscriptions; authZ hooks.
- **Workflow Engine (Rust)**: durable state machines, scheduler/executor, retries/timeouts/circuit-breaking, persists to Postgres, emits events to stream.
- **Event Stream (Kafka/Redpanda/NATS)**: carries engine events to analytics and subscriptions.
- **Analytics Service (Rust or Node)**: consumes events, builds aggregates, exposes metrics via GraphQL/REST; raises alerts; notifier service delivers Slack/email/PagerDuty/webhooks.

## Data Model (Postgres)
- `workflows(id, name)`
- `workflow_versions(id, workflow_id, version, definition_json, created_at, published_at)`
- `workflow_runs(id, workflow_version_id, state, created_at, started_at, completed_at, error, metadata)`
- `step_runs(id, workflow_run_id, step_id, state, started_at, completed_at, attempt, error, payload)`
- `events(id, workflow_run_id, step_id, event_type, payload_json, ts, trace_id, corr_id)`
- Idempotency: dedupe key `(workflow_run_id, step_id, attempt, event_type, corr_id)`.

## Engine Design (Rust)
- States: workflow `created → pending → running → completed/failed/cancelled`; step `idle → queued → running → succeeded/failed/skipped`.
- Steps: `HttpCall`, `Task`, `Delay`, `HumanApproval`, `Script`; edges with optional conditions.
- Scheduler: finds runnable steps (deps succeeded, conditions true), enqueues to executors.
- Executors: per step kind; supports retries (exp backoff + jitter), timeouts, circuit breakers, cancellation.
- Events emitted: `run_started`, `state_changed`, `step_started`, `step_completed`, `step_failed`, `alert_triggered`.
- API (gRPC + HTTP mirror):
  - `CreateWorkflow`, `UpdateWorkflowVersion`, `PublishWorkflowVersion`
  - `StartRun`, `CancelRun`, `GetRun`, `ListRuns`
  - `TriggerManualTransition` (approvals), `RetryRun`, `RetryStep`
- Event schema (topic `staterail.events.v1`): `event_type, workflow_id, workflow_version, run_id, step_id, attempt, state_before, state_after, payload, ts, trace_id, corr_id, emitter`.

## GraphQL Layer (Node)
- Types: `Workflow`, `WorkflowVersion`, `Step`, `Transition`, `WorkflowRun`, `StepRun`, `Event`, `Metric`, `Alert`.
- Queries: list/get workflows; runs by workflow; run by id; stepRuns; events(runId); metricsByWorkflow; metricsByTimeRange.
- Mutations: `createWorkflow`, `updateWorkflowVersion`, `publishWorkflowVersion`, `startRun`, `cancelRun`, `retryRun`, `retryStep`, `createManualTransition`.
- Subscriptions: `runUpdated(runId)`, `stepUpdated(runId)`, `alertRaised(workflowId)`.
- Resolvers: mutations/projections call engine; queries pull Postgres; metrics from analytics; subscriptions fed from stream via pub/sub.
- Auth: context middleware; RBAC placeholders; tenant scoping on every call.

## Analytics & Alerts
- Consumer ingests engine events → stores normalized events and aggregates.
- Aggregates: P95/P99 step/workflow durations; failure rate per workflow/step; throughput over time; stuck workflows (no event > X min).
- Metrics API: `metricsByWorkflow`, `metricsByTimeRange`, `topFailingSteps`, `slaBreaches`.
- Alerting rules: `failure_rate > threshold`, `duration > SLA`; emit `alert_raised`; notifier dispatches Slack/email/PagerDuty/webhook.

## Frontend (React + D3/React Flow)
- Surfaces: Workflow Builder; Runs list/detail with timeline; Live State Graph; Analytics dashboards; Alerts panel.
- State: TanStack Query for server state; subscriptions for live updates; Zustand/Redux Toolkit for editor UI.
- UX patterns: node/edge editing with side panel; live coloring (running=blue, succeeded=green, failed=red, pending=gray, skipped=yellow); toasts on failures; drilldown alert → workflow → run → step → logs.

## Reliability Checklist
- Idempotent mutations and event handlers (dedupe on corr_id).
- Durable writes before ack; at-least-once events with consumer dedupe.
- Retries with bounded exponential backoff + jitter; timeouts per step/run; cancellation propagation.
- Circuit breakers for flaky upstreams; DLQ for poison tasks.
- Structured logging + OTEL tracing (trace_id/corr_id in all events); health checks.
- Backpressure in scheduler/executor; rate limits on APIs.

## Monorepo Layout (proposed)
- `apps/frontend` (React/TS, Vite, React Flow/D3, TanStack Query)
- `apps/api` (Node/TS, GraphQL Yoga/Apollo, Nexus/TypeGraphQL, WS for subscriptions)
- `apps/engine` (Rust, Cargo workspace with core + adapters)
- `apps/analytics` (Rust or Node consumer + metrics API)
- `packages/shared` (schemas, types, proto/IDL, telemetry)
- `infra` (docker-compose/terraform/local env; broker + Postgres)
- `docs` (this file, ADRs)

## Phase Plan
- **Phase 1 (MVP)**: Rust engine w/ Postgres or in-memory; HTTP API for start/get/cancel; GraphQL for definitions + start/get; React builder + run detail (polling).
- **Phase 2 (Durability + Events)**: full persistence; retries/timeouts; event streaming; GraphQL subscriptions; live UI updates; event log table.
- **Phase 3 (Analytics + Alerts)**: analytics consumer + aggregates; metrics endpoints; alert rules + notifier; dashboards + alerts UI.
- **Phase 4 (Operator Polish)**: circuit breakers, RBAC, audit logs; search/filters; triage UX; SLA chips; observability hardening.

## Next Actions
1) Init monorepo structure above (pnpm workspaces + cargo workspace).
2) Define shared schemas (Protobuf/JSON Schema) for events and gRPC; generate TS/Rust types.
3) Scaffold engine crates: `core`, `scheduler`, `executors`, `storage-postgres`, `api-grpc`.
4) Scaffold API GraphQL server with schema stubs and subscriptions bridge to stream.
5) Scaffold frontend with React Flow-based builder and subscriptions for live runs.
6) Add docker-compose for Postgres + Redpanda/Kafka + Jaeger + Grafana/Tempo + Prometheus (optional).
